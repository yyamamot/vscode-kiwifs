import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { createAdapter } from "../adapter/createAdapter";
import { resolveKiwiConfig } from "../config/resolveConfig";
import { JsonlLogger } from "../logging/jsonlLogger";
import { KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";
import { classifyAttachmentEditorView } from "./attachmentEditorSupport";
import {
  AttachmentUploadService,
  openAttachmentInEditor
} from "./attachmentServices";
import { buildAttachmentQuickPickItems } from "./buildAttachmentQuickPickItems";
import {
  CaseAttachmentContentProvider,
  CaseAttachmentsDocumentProvider
} from "./documentProviders";
import { caseAttachmentsUri } from "./extensionUris";
import { humanMessage, logInBackground } from "./extensionRuntimeSupport";
import { pickAttachmentForBrowser } from "./quickPickHelpers";
import { renderCaseAttachmentsDocument } from "./renderCaseAttachmentsDocument";
import { resolveCaseAttachmentTarget } from "./commandTargetResolvers";
import { localize } from "./l10n";

type ClientFactory = () => Promise<{
  adapter: ReturnType<typeof createAdapter>;
  config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
}>;

export function registerAttachmentCommands(args: {
  clientFactory: ClientFactory;
  logger: JsonlLogger;
  caseAttachmentsProvider: CaseAttachmentsDocumentProvider;
  caseAttachmentContentProvider: CaseAttachmentContentProvider;
  attachmentUploadService: AttachmentUploadService;
}): vscode.Disposable[] {
  const {
    clientFactory,
    logger,
    caseAttachmentsProvider,
    caseAttachmentContentProvider,
    attachmentUploadService
  } = args;

  return [
    vscode.commands.registerCommand("kiwi.showCaseAttachments", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseAttachmentTarget(target);
      if (!resolved) {
        return;
      }

      try {
        const { adapter, config } = await clientFactory();
        const attachments = await adapter.listCaseAttachments(config, resolved.caseRef.id);
        const uri = caseAttachmentsUri(resolved.plan, resolved.caseRef);
        caseAttachmentsProvider.setContent(
          uri,
          renderCaseAttachmentsDocument({
            caseId: resolved.caseRef.id,
            summary: resolved.caseRef.summary,
            attachments
          })
        );
        await vscode.commands.executeCommand("vscode.open", uri);
        return uri.toString();
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.addCaseAttachment", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseAttachmentTarget(target);
      if (!resolved) {
        return;
      }

      const selection = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
        openLabel: localize("Add Attachment")
      });
      if (!selection?.[0]) {
        return undefined;
      }

      try {
        const files = await Promise.all(
          selection.map(async (item) => ({
            filename: path.basename(item.fsPath),
            data: await readFile(item.fsPath)
          }))
        );
        await attachmentUploadService.uploadFilesToCase(resolved, files);
        void vscode.window.showInformationMessage(
          files.length === 1 ? localize("Attachment added.") : localize("{0} files attached.", files.length)
        );
        return selection.map((item) => item.fsPath);
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand(
      "kiwi.openCaseAttachmentInBrowser",
      async (target?: KiwiPlansTreeNode) => {
        const resolved = await resolveCaseAttachmentTarget(target);
        if (!resolved) {
          return undefined;
        }

        try {
          const { adapter, config } = await clientFactory();
          const attachments = await adapter.listCaseAttachments(config, resolved.caseRef.id);
          if (attachments.length === 0) {
            void vscode.window.showInformationMessage("No attachments found for this case.");
            return undefined;
          }

          const items = buildAttachmentQuickPickItems(attachments);
          if (items.length === 0) {
            void vscode.window.showInformationMessage(
              "No browser-openable attachments found for this case."
            );
            return undefined;
          }

          const picked = await pickAttachmentForBrowser(
            items,
            localize("Select an attachment: {0}", resolved.caseRef.summary)
          );
          if (!picked) {
            return undefined;
          }

          const url = picked.attachment.downloadUrl!;
          await vscode.env.openExternal(vscode.Uri.parse(url));
          return url;
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.openCaseAttachmentInEditor",
      async (target?: KiwiPlansTreeNode) => {
        const resolved = await resolveCaseAttachmentTarget(target);
        if (!resolved) {
          return undefined;
        }

        try {
          const { adapter, config } = await clientFactory();
          const attachments = await adapter.listCaseAttachments(config, resolved.caseRef.id);
          if (attachments.length === 0) {
            void vscode.window.showInformationMessage("No attachments found for this case.");
            return undefined;
          }

          const items = buildAttachmentQuickPickItems(attachments);
          if (items.length === 0) {
            void vscode.window.showInformationMessage(
              "No editor-openable attachments found for this case."
            );
            return undefined;
          }

          const picked = await pickAttachmentForBrowser(
            items,
            localize("Select an attachment: {0}", resolved.caseRef.summary)
          );
          if (!picked) {
            return undefined;
          }

          const content = await adapter.getCaseAttachmentContent(
            config,
            picked.attachment.downloadUrl!
          );
          const resolvedFilename = content.filename || picked.attachment.filename;
          logInBackground(logger, {
            level: "info",
            event: "attachment.editor.started",
            source: "runtime",
            operation: "openCaseAttachmentInEditor",
            entityType: "attachment",
            entityId: `${resolved.caseRef.id}`,
            virtualPath: picked.attachment.downloadUrl ?? "",
            outcome: "started",
            details: `attachmentFilename=${picked.attachment.filename} contentFilename=${content.filename ?? ""}`
          });
          const viewKind = classifyAttachmentEditorView(content, resolvedFilename);
          logInBackground(logger, {
            level: "info",
            event: "attachment.editor.classified",
            source: "runtime",
            operation: "openCaseAttachmentInEditor",
            entityType: "attachment",
            entityId: `${resolved.caseRef.id}`,
            virtualPath: picked.attachment.downloadUrl ?? "",
            outcome: "succeeded",
            details: `attachmentFilename=${picked.attachment.filename} contentFilename=${content.filename ?? ""} contentType=${content.contentType ?? ""} viewKind=${viewKind} downloadUrl=${picked.attachment.downloadUrl ?? ""}`
          });
          if (viewKind === "unsupported") {
            void vscode.window.showInformationMessage(
              localize("This attachment is not supported for inline editor view. Use 'Show Attachment in Browser'.")
            );
            return undefined;
          }

          const openedUri = await openAttachmentInEditor(
            caseAttachmentContentProvider,
            resolved,
            resolvedFilename,
            content,
            viewKind,
            logger,
            picked.attachment.downloadUrl ?? ""
          );
          return openedUri.toString();
        } catch (error) {
          logInBackground(logger, {
            level: "error",
            event: "attachment.editor.failed",
            source: "runtime",
            operation: "openCaseAttachmentInEditor",
            entityType: "attachment",
            entityId: "unknown",
            virtualPath: "",
            outcome: "failed",
            message: humanMessage(error)
          });
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    )
  ];
}
