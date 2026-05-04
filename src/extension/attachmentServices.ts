import * as vscode from "vscode";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createAdapter } from "../adapter/createAdapter";
import { resolveKiwiConfig } from "../config/resolveConfig";
import { JsonlLogger } from "../logging/jsonlLogger";
import { KiwiCaseAttachmentContent } from "../types";
import { KiwiError } from "../domain/errors";
import { caseFileName, planDirectoryName } from "../domain/pathCodec";
import {
  classifyAttachmentEditorView,
  inferAttachmentLanguage,
  type AttachmentEditorViewKind
} from "./attachmentEditorSupport";
import {
  extractDroppedFiles,
  resolveAttachmentDropTarget,
  type UploadableAttachment
} from "./attachmentDragAndDrop";
import { type KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";
import { CaseAttachmentContentProvider } from "./documentProviders";
import { localize } from "./l10n";

export async function openAttachmentInEditor(
  provider: CaseAttachmentContentProvider,
  target: { plan: { id: number; name: string }; caseRef: { id: number; summary: string } },
  filename: string,
  content: KiwiCaseAttachmentContent,
  viewKind: AttachmentEditorViewKind,
  logger: JsonlLogger,
  downloadUrl: string
): Promise<vscode.Uri> {
  if (viewKind === "text") {
    const uri = caseAttachmentContentUri(target.plan, target.caseRef, filename);
    provider.setContent(uri, Buffer.from(content.body).toString("utf8"));
    const document = await vscode.workspace.openTextDocument(uri);
    const withLanguage = await vscode.languages.setTextDocumentLanguage(
      document,
      inferAttachmentLanguage(filename)
    );
    await vscode.window.showTextDocument(withLanguage, { preview: false });
    logInBackground(logger, {
      level: "info",
      event: "attachment.editor.opened",
      source: "runtime",
      operation: "openCaseAttachmentInEditor",
      entityType: "attachment",
      entityId: `${target.caseRef.id}`,
      virtualPath: downloadUrl,
      outcome: "succeeded",
      details: `viewKind=${viewKind} openedUri=${uri.toString()} openMethod=showTextDocument`
    });
    return uri;
  }

  const fileUri = await writeAttachmentTempFile(target.caseRef.id, filename, Buffer.from(content.body));
  if (viewKind === "preview-image") {
    try {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        fileUri,
        "imagePreview.previewEditor"
      );
      logInBackground(logger, {
        level: "info",
        event: "attachment.editor.opened",
        source: "runtime",
        operation: "openCaseAttachmentInEditor",
        entityType: "attachment",
        entityId: `${target.caseRef.id}`,
        virtualPath: downloadUrl,
        outcome: "succeeded",
        details: `viewKind=${viewKind} openedUri=${fileUri.toString()} openMethod=openWith:imagePreview.previewEditor`
      });
    } catch {
      await vscode.commands.executeCommand("vscode.open", fileUri);
      logInBackground(logger, {
        level: "info",
        event: "attachment.editor.opened",
        source: "runtime",
        operation: "openCaseAttachmentInEditor",
        entityType: "attachment",
        entityId: `${target.caseRef.id}`,
        virtualPath: downloadUrl,
        outcome: "succeeded",
        details: `viewKind=${viewKind} openedUri=${fileUri.toString()} openMethod=fallback-open`
      });
    }
    return fileUri;
  }

  await vscode.commands.executeCommand("vscode.open", fileUri);
  logInBackground(logger, {
    level: "info",
    event: "attachment.editor.opened",
    source: "runtime",
    operation: "openCaseAttachmentInEditor",
    entityType: "attachment",
    entityId: `${target.caseRef.id}`,
    virtualPath: downloadUrl,
    outcome: "succeeded",
    details: `viewKind=${viewKind} openedUri=${fileUri.toString()} openMethod=open`
  });
  return fileUri;
}

export class AttachmentUploadService {
  constructor(
    private readonly clientFactory: () => Promise<{
      adapter: ReturnType<typeof createAdapter>;
      config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
    }>
  ) {}

  async uploadFilesToCase(
    target: Extract<KiwiPlansTreeNode, { kind: "case" }>,
    files: UploadableAttachment[]
  ): Promise<number> {
    if (files.length === 0) {
      return 0;
    }

    const { adapter, config } = await this.clientFactory();
    for (const file of files) {
      await adapter.addCaseAttachment(
        config,
        target.caseRef.id,
        file.filename,
        Buffer.from(file.data).toString("base64")
      );
    }
    return files.length;
  }
}

export class KiwiPlansDragAndDropController
  implements vscode.TreeDragAndDropController<KiwiPlansTreeNode> {
  readonly dropMimeTypes = ["files"];
  readonly dragMimeTypes: string[] = [];

  constructor(
    private readonly attachmentUploadService: AttachmentUploadService,
    private readonly logger: JsonlLogger,
    private readonly getSelection: () => readonly KiwiPlansTreeNode[]
  ) {}

  async handleDrop(
    target: KiwiPlansTreeNode | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    const resolvedTarget = resolveAttachmentDropTarget(target, this.getSelection());
    logInBackground(this.logger, {
      level: "info",
      event: "attachment.drop.started",
      source: "provider",
      operation: "handleDrop",
      entityType: "attachment",
      entityId: resolvedTarget ? String(resolvedTarget.caseRef.id) : "unknown",
      virtualPath: resolvedTarget
        ? `kiwi:/plans/${planDirectoryName(resolvedTarget.plan)}/cases/${caseFileName(resolvedTarget.caseRef)}`
        : "kiwi:/plans/",
      outcome: "started",
      details: `targetKind=${target?.kind ?? "undefined"} selectionCaseCount=${this.getSelection().filter((item) => item.kind === "case").length}`
    });

    if (!resolvedTarget) {
      const error = new KiwiError("ValidationFailed", localize("Drop files onto a case."));
      await this.logDropFailure(error, target);
      throw error;
    }

    const files = await extractDroppedFiles(dataTransfer);
    if (files.length === 0) {
      const error = new KiwiError("ValidationFailed", localize("Could not read dropped files."));
      await this.logDropFailure(error, resolvedTarget);
      void vscode.window.showInformationMessage(error.message);
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Adding attachments",
          cancellable: false
        },
        async () => {
          const uploaded = await this.attachmentUploadService.uploadFilesToCase(resolvedTarget, files);
          logInBackground(this.logger, {
            level: "info",
            event: "attachment.drop.succeeded",
            source: "provider",
            operation: "handleDrop",
            entityType: "attachment",
            entityId: String(resolvedTarget.caseRef.id),
            virtualPath: `kiwi:/plans/${planDirectoryName(resolvedTarget.plan)}/cases/${caseFileName(resolvedTarget.caseRef)}`,
            outcome: "succeeded",
            details: `count=${uploaded}`
          });
          void vscode.window.showInformationMessage(
            uploaded === 1 ? localize("Attachment added.") : localize("{0} files attached.", uploaded)
          );
        }
      );
    } catch (error) {
      await this.logDropFailure(error, resolvedTarget);
      throw error;
    }
  }

  private async logDropFailure(
    error: unknown,
    target: KiwiPlansTreeNode | undefined
  ): Promise<void> {
    await this.logger.log({
      level: "error",
      event:
        error instanceof KiwiError && error.code === "ValidationFailed"
          ? "attachment.drop.rejected"
          : "attachment.drop.failed",
      source: "provider",
      operation: "handleDrop",
      entityType: "attachment",
      entityId: target?.kind === "case" ? String(target.caseRef.id) : "unknown",
      virtualPath:
        target?.kind === "case"
          ? `kiwi:/plans/${planDirectoryName(target.plan)}/cases/${caseFileName(target.caseRef)}`
          : "kiwi:/plans/",
      outcome: "failed",
      errorCode: error instanceof KiwiError ? error.code : "Unknown",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function caseAttachmentContentUri(
  plan: { id: number; name: string },
  caseRef: { id: number; summary: string },
  filename: string
): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-attachment:/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/cases/${encodeURIComponent(`${caseRef.id} - ${caseRef.summary}.md`)}/attachments/${encodeURIComponent(filename)}`
  );
}

async function writeAttachmentTempFile(
  caseId: number,
  filename: string,
  body: Buffer
): Promise<vscode.Uri> {
  const safeName = path.basename(filename);
  const directory = path.join(tmpdir(), "kiwifs-attachments", String(caseId));
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, safeName);
  await writeFile(filePath, body);
  return vscode.Uri.file(filePath);
}

function logInBackground(
  logger: JsonlLogger,
  event: Parameters<JsonlLogger["log"]>[0]
): void {
  void logger.log(event).catch(() => undefined);
}
