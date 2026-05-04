import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { createAdapter } from "../../adapter/createAdapter";
import {
  readStoredPassword,
  readStoredUsername,
  resolveKiwiConfig
} from "../../config/resolveConfig";
import { KiwiError } from "../../domain/errors";
import { JsonlLogger } from "../../logging/jsonlLogger";
import { buildAttachmentQuickPickItems } from "../buildAttachmentQuickPickItems";
import { classifyAttachmentEditorView } from "../attachmentEditorSupport";
import { AttachmentUploadService, openAttachmentInEditor } from "../attachmentServices";
import { CaseAttachmentContentProvider } from "../documentProviders";
import {
  createKiwiLocalMirrorSourceControl,
  LocalMirrorScmResource
} from "../localMirrorSourceControl";
import { CaseFreshnessService } from "../caseFreshnessService";
import { KiwiFileSystemProvider } from "../../provider/KiwiFileSystemProvider";
import { KiwiPlansTreeDataProvider, type KiwiPlansTreeNode } from "../KiwiPlansTreeDataProvider";
import { activeCaseNode } from "../extensionUris";
import { logInBackground } from "../extensionRuntimeSupport";
import { resolveCaseAttachmentTarget } from "../commandTargetResolvers";
import { regressionCaseNode, regressionPlanNode } from "./testCommandTargets";

export function registerIntegrationTestCommands(args: {
  context: vscode.ExtensionContext;
  clientFactory: () => Promise<{
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
    adapter: ReturnType<typeof createAdapter>;
  }>;
  logger: JsonlLogger;
  provider: KiwiFileSystemProvider;
  treeDataProvider: KiwiPlansTreeDataProvider;
  caseFreshnessService: CaseFreshnessService;
  caseAttachmentContentProvider: CaseAttachmentContentProvider;
  attachmentUploadService: AttachmentUploadService;
  localMirrorSourceControl: ReturnType<typeof createKiwiLocalMirrorSourceControl>;
  localMirrorRemoteMetadataChecker: {
    checkCurrentLocalChangedResources(): Promise<boolean>;
    checkCurrentMirrorMetadata(): Promise<boolean>;
  };
  checkCaseFreshness: (args: {
    target?: KiwiPlansTreeNode;
    provider: KiwiFileSystemProvider;
    treeDataProvider: KiwiPlansTreeDataProvider;
    service: CaseFreshnessService;
    showActions: boolean;
  }) => Promise<unknown>;
  resolveCaseBrowserTarget: (
    target: KiwiPlansTreeNode | undefined,
    clientFactory: () => Promise<{
      config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
      adapter: ReturnType<typeof createAdapter>;
    }>
  ) => Promise<{ uri: vscode.Uri } | undefined>;
  resolvePlanBrowserTarget: (
    target: KiwiPlansTreeNode | undefined,
    clientFactory: () => Promise<{
      config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
      adapter: ReturnType<typeof createAdapter>;
    }>
  ) => Promise<{ uri: vscode.Uri } | undefined>;
}): vscode.Disposable[] {
  const {
    context,
    clientFactory,
    logger,
    provider,
    treeDataProvider,
    caseFreshnessService,
    caseAttachmentContentProvider,
    attachmentUploadService,
    localMirrorSourceControl,
    localMirrorRemoteMetadataChecker,
    checkCaseFreshness,
    resolveCaseBrowserTarget,
    resolvePlanBrowserTarget
  } = args;

  return [
    vscode.commands.registerCommand("kiwi.__test.readCaseState", async (caseId: number) => {
      const state = await clientFactory();
      return state.adapter.getCase(state.config, caseId);
    }),
    vscode.commands.registerCommand("kiwi.__test.showCaseAttachments", async () => {
      const target = regressionCaseNode();
      return vscode.commands.executeCommand("kiwi.showCaseAttachments", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.openCaseAttachmentInBrowser", async () => {
      const { adapter, config } = await clientFactory();
      const attachments = await adapter.listCaseAttachments(config, 501);
      const items = buildAttachmentQuickPickItems(attachments);
      return items.find((item) => item.label === "existing.txt")?.attachment.downloadUrl;
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.openCaseAttachmentInEditor",
      async (filename = "existing.txt") => {
        const target = regressionCaseNode();
        const { adapter, config } = await clientFactory();
        const attachments = await adapter.listCaseAttachments(config, 501);
        const item = buildAttachmentQuickPickItems(attachments).find(
          (entry) => entry.label === filename
        );
        if (!item) {
          return undefined;
        }
        const content = await adapter.getCaseAttachmentContent(config, item.attachment.downloadUrl!);
        const resolvedFilename = content.filename || item.attachment.filename;
        logInBackground(logger, {
          level: "info",
          event: "attachment.editor.started",
          source: "runtime",
          operation: "openCaseAttachmentInEditor",
          entityType: "attachment",
          entityId: `${target.caseRef.id}`,
          virtualPath: item.attachment.downloadUrl ?? "",
          outcome: "started",
          details: `attachmentFilename=${item.attachment.filename} contentFilename=${content.filename ?? ""}`
        });
        const viewKind = classifyAttachmentEditorView(content, resolvedFilename);
        logInBackground(logger, {
          level: "info",
          event: "attachment.editor.classified",
          source: "runtime",
          operation: "openCaseAttachmentInEditor",
          entityType: "attachment",
          entityId: `${target.caseRef.id}`,
          virtualPath: item.attachment.downloadUrl ?? "",
          outcome: "succeeded",
          details: `attachmentFilename=${item.attachment.filename} contentFilename=${content.filename ?? ""} contentType=${content.contentType ?? ""} viewKind=${viewKind} downloadUrl=${item.attachment.downloadUrl ?? ""}`
        });
        if (viewKind === "unsupported") {
          return "unsupported";
        }
        const openedUri = await openAttachmentInEditor(
          caseAttachmentContentProvider,
          target,
          resolvedFilename,
          content,
          viewKind,
          logger,
          item.attachment.downloadUrl ?? ""
        );
        return openedUri.toString();
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.addCaseAttachment",
      async (filePath: string, target?: KiwiPlansTreeNode) => {
        const fallbackTarget = regressionCaseNode();
        const resolved = await resolveCaseAttachmentTarget(target ?? fallbackTarget);
        if (!resolved) {
          return undefined;
        }
        const data = await readFile(filePath);
        await attachmentUploadService.uploadFilesToCase(resolved, [
          { filename: path.basename(filePath), data }
        ]);
        return filePath;
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.showPlanInfo", async () => {
      const target = regressionPlanNode();
      return vscode.commands.executeCommand("kiwi.showPlanInfo", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.resolveConfig", async () => {
      return resolveKiwiConfig(context);
    }),
    vscode.commands.registerCommand("kiwi.__test.readStoredConfiguration", async () => {
      return {
        baseUrl: vscode.workspace.getConfiguration("kiwi").get<string>("baseUrl") ?? "",
        username: await readStoredUsername(context),
        password: await readStoredPassword(context)
      };
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.downloadPlanToLocalMirror",
      async (forceOverwrite?: boolean, skipConfirmation?: boolean) => {
        const target = regressionPlanNode();
        return vscode.commands.executeCommand(
          "kiwi.downloadPlanToLocalMirror",
          target,
          forceOverwrite,
          skipConfirmation
        );
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.comparePlanLocalMirror", async () => {
      const target = regressionPlanNode();
      return vscode.commands.executeCommand("kiwi.comparePlanLocalMirror", target, {
        openEditor: false
      });
    }),
    vscode.commands.registerCommand("kiwi.__test.uploadPlanLocalMirror", async () => {
      const target = regressionPlanNode();
      return vscode.commands.executeCommand("kiwi.uploadPlanLocalMirror", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.showCaseDiff", async () => {
      const target = regressionCaseNode();
      return vscode.commands.executeCommand("kiwi.showCaseDiff", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.showCaseHistoryDiff", async (historyId: number) => {
      const target = regressionCaseNode();
      return vscode.commands.executeCommand("kiwi.showCaseHistoryDiff", target, historyId);
    }),
    vscode.commands.registerCommand("kiwi.__test.showCaseHistory", async () => {
      const target = regressionCaseNode();
      return vscode.commands.executeCommand("kiwi.showCaseHistory", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.checkCaseFreshness", async () => {
      const target = regressionCaseNode();
      return checkCaseFreshness({
        target,
        provider,
        treeDataProvider,
        service: caseFreshnessService,
        showActions: false
      });
    }),
    vscode.commands.registerCommand("kiwi.__test.openInBrowser", async (target?: KiwiPlansTreeNode) => {
      const fallbackTarget = regressionCaseNode();
      const resolved = await resolveCaseBrowserTarget(
        target ?? activeCaseNode() ?? fallbackTarget,
        clientFactory
      );
      return resolved?.uri.toString();
    }),
    vscode.commands.registerCommand("kiwi.__test.openPlanInBrowser", async () => {
      const target = regressionPlanNode();
      const resolved = await resolvePlanBrowserTarget(target, clientFactory);
      return resolved?.uri.toString();
    }),
    vscode.commands.registerCommand("kiwi.__test.downloadLocalMirror", async (forceOverride?: boolean) => {
      const target = regressionCaseNode();
      return vscode.commands.executeCommand("kiwi.downloadCaseToLocalMirror", target, forceOverride);
    }),
    vscode.commands.registerCommand("kiwi.__test.compareLocalMirror", async () => {
      const target = regressionCaseNode();
      return vscode.commands.executeCommand("kiwi.compareLocalMirror", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.getLocalMirrorScmState", async () => {
      return localMirrorSourceControl.getState();
    }),
    vscode.commands.registerCommand("kiwi.__test.openLocalMirrorScmDiff", async (resource?: LocalMirrorScmResource) => {
      return vscode.commands.executeCommand("kiwi.openLocalMirrorScmDiff", resource);
    }),
    vscode.commands.registerCommand("kiwi.__test.scmCompareLocalMirrorAgain", async () => {
      return vscode.commands.executeCommand("kiwi.scmCompareLocalMirrorAgain", {
        openEditor: false
      });
    }),
    vscode.commands.registerCommand("kiwi.__test.checkCurrentLocalMirrorMetadata", async () => {
      return localMirrorRemoteMetadataChecker.checkCurrentLocalChangedResources();
    }),
    vscode.commands.registerCommand("kiwi.__test.scmCheckRemoteLocalMirrorMetadata", async () => {
      return vscode.commands.executeCommand("kiwi.scmCheckRemoteLocalMirrorMetadata");
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.scmUploadLocalMirrorResources",
      async (resources?: LocalMirrorScmResource[]) => {
        return vscode.commands.executeCommand("kiwi.scmUploadLocalMirrorResources", resources);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.scmTakeRemoteLocalMirrorResources",
      async (resources?: LocalMirrorScmResource[]) => {
        return vscode.commands.executeCommand("kiwi.scmTakeRemoteLocalMirrorResources", resources);
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.uploadLocalMirror", async () => {
      const target = regressionCaseNode();
      return vscode.commands.executeCommand("kiwi.uploadLocalMirror", target);
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.dropAttachments",
      async (filePaths: string[], target?: KiwiPlansTreeNode) => {
        const resolved = target?.kind === "case" ? target : undefined;
        if (!resolved) {
          throw new KiwiError("ValidationFailed", "Drop files on a Kiwi case.");
        }
        const files = await Promise.all(
          filePaths.map(async (filePath) => ({
            filename: path.basename(filePath),
            data: await readFile(filePath)
          }))
        );
        await attachmentUploadService.uploadFilesToCase(resolved, files);
        return filePaths.length;
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.revealLocalMirror", async () => {
      const target = regressionCaseNode();
      return vscode.commands.executeCommand("kiwi.revealLocalMirror", target);
    })
  ];
}
