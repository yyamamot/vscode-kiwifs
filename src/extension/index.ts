import * as vscode from "vscode";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  clearCredentials,
  clearPassword,
  clearUsername,
  normalizeBaseUrlInput,
  normalizeSecretInput,
  readStoredPassword,
  readStoredUsername,
  resolveKiwiConfig,
  storePassword,
  storeUsername
} from "../config/resolveConfig";
import { createAdapter } from "../adapter/createAdapter";
import {
  KiwiCase,
  KiwiCaseAttachment,
  KiwiCaseAttachmentContent,
  KiwiCaseBody
} from "../types";
import { KiwiFileSystemProvider } from "../provider/KiwiFileSystemProvider";
import { JsonlLogger } from "../logging/jsonlLogger";
import { deriveVersionToken } from "../domain/versionToken";
import { buildCaseHistoryQuickPickItems } from "./buildCaseHistoryQuickPickItems";
import { KiwiError } from "../domain/errors";
import {
  caseInfoUri,
  caseDocumentUri,
  KiwiPlansTreeDataProvider,
  KiwiPlansTreeNode
} from "./KiwiPlansTreeDataProvider";
import { renderCaseInfoDocument } from "./renderCaseInfoDocument";
import { renderCaseDiffDocument, renderCaseDiffTitle } from "./renderCaseDiffDocument";
import { renderCaseAttachmentsDocument } from "./renderCaseAttachmentsDocument";
import { renderPlanInfoDocument } from "./renderPlanInfoDocument";
import { renderPlanLocalMirrorStatusDocument } from "./renderPlanLocalMirrorStatusDocument";
import { caseFileName, parseNumericPrefix, planDirectoryName } from "../domain/pathCodec";
import { buildCaseBrowserUri } from "./buildCaseBrowserUri";
import { buildPlanBrowserUri } from "./buildPlanBrowserUri";
import { LocalMirrorService } from "./localMirrorService";
import {
  AttachmentQuickPickItem,
  buildAttachmentQuickPickItems
} from "./buildAttachmentQuickPickItems";
import {
  buildCaseSearchQuickPickItems,
  filterCaseSearchMatches,
  type CaseSearchQuickPickItem
} from "./buildCaseSearchQuickPickItems";
import {
  buildExistingCaseToPlanEntries,
  buildExistingCaseToPlanQuickPickItems,
  type ExistingCaseToPlanQuickPickItem
} from "./buildExistingCaseToPlanQuickPickItems";
import {
  buildRemoveCaseFromPlanQuickPickItems,
  type RemoveCaseFromPlanQuickPickItem
} from "./buildRemoveCaseFromPlanQuickPickItems";
import {
  buildExecutionQuickPickItems,
  type ExecutionQuickPickItem
} from "./buildExecutionQuickPickItems";
import {
  classifyAttachmentEditorView,
  inferAttachmentLanguage,
  type AttachmentEditorViewKind
} from "./attachmentEditorSupport";
import {
  extractDroppedFiles,
  resolveAttachmentDropTarget,
  UploadableAttachment
} from "./attachmentDragAndDrop";
import {
  CaseMetadataEditorController,
  type MetadataEditorMode,
  type MetadataEditorTarget,
  type MetadataEditorSaveResult
} from "./caseMetadataEditorController";
import { CaseFilterController } from "./caseFilterController";
import {
  ExecutionResultController,
  type ExecutionResultSaveResult
} from "./executionResultController";
import { CaseExecutionBoardController } from "./caseExecutionBoardController";
import { TestRunDashboardController } from "./testRunDashboardController";

let providerRegistration: vscode.Disposable | undefined;
const RUNTIME_LOGS_ENABLED_CONTEXT = "kiwi.runtimeLogsEnabled";

function isDebugF5Runtime(): boolean {
  return process.env.KIWI_RUNTIME_MODE === "debug-f5";
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await vscode.commands.executeCommand("setContext", RUNTIME_LOGS_ENABLED_CONTEXT, isDebugF5Runtime());
  const logger = new JsonlLogger();
  const adapterCache = new Map<string, ReturnType<typeof createAdapter>>();
  const clientFactory = async () => {
    const config = await resolveKiwiConfig(context);
    const key = `${config.baseUrl}\n${config.username}\n${config.password}`;
    let adapter = adapterCache.get(key);
    if (!adapter) {
      adapter = createAdapter(config.baseUrl);
      adapterCache.set(key, adapter);
    }
    return {
      config,
      adapter
    };
  };
  const provider = new KiwiFileSystemProvider(clientFactory, logger);
  const treeDataProvider = new KiwiPlansTreeDataProvider(clientFactory, logger);
  const attachmentUploadService = new AttachmentUploadService(clientFactory);
  const metadataEditorController = new CaseMetadataEditorController(clientFactory, async (result) => {
      await handleCaseMetadataEditorSaved({
        caseProvider: provider,
        treeDataProvider,
        result
      });
    });
  const caseFilterController = new CaseFilterController(clientFactory, async (result) => {
    const uri = caseDocumentUri(result.plan, result.caseRef);
    await vscode.commands.executeCommand("vscode.open", uri);
    return uri;
  });
  const executionResultController = new ExecutionResultController(clientFactory, async (result) => {
    await handleExecutionResultSaved(result);
  });
  const caseExecutionBoardController = new CaseExecutionBoardController(clientFactory, logger, async (result) => {
    const uri = caseDocumentUri(result.plan, result.caseRef);
    await vscode.commands.executeCommand("vscode.open", uri);
    return uri;
  });
  const testRunDashboardController = new TestRunDashboardController(clientFactory, logger, async (result) => {
    const { adapter, config } = await clientFactory();
    const caseData = await adapter.getCase(config, result.caseRef.id);
    const planData = await adapter.getPlan(config, caseData.planId);
    const uri = caseDocumentUri({ id: planData.id, name: planData.name }, result.caseRef);
    await vscode.commands.executeCommand("vscode.open", uri);
    return uri;
  });
  providerRegistration = vscode.workspace.registerFileSystemProvider("kiwi", provider, {
    isCaseSensitive: true
  });
  context.subscriptions.push(providerRegistration);
  context.subscriptions.push(metadataEditorController);
  context.subscriptions.push(caseFilterController);
  context.subscriptions.push(executionResultController);
  context.subscriptions.push(caseExecutionBoardController);
  context.subscriptions.push(testRunDashboardController);
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (isCaseDocumentUri(document.uri)) {
        provider.releaseCaseDocument(document.uri);
      }
    })
  );
  let treeView: vscode.TreeView<KiwiPlansTreeNode>;
  treeView = vscode.window.createTreeView("kiwiPlans", {
    treeDataProvider,
    dragAndDropController: new KiwiPlansDragAndDropController(
      attachmentUploadService,
      logger,
      () => treeView.selection
    )
  });
  context.subscriptions.push(treeView);
  const caseInfoProvider = new CaseInfoDocumentProvider();
  const caseDiffProvider = new CaseDiffDocumentProvider();
  const planInfoProvider = new PlanInfoDocumentProvider();
  const planLocalMirrorStatusProvider = new PlanLocalMirrorStatusDocumentProvider();
  const caseAttachmentsProvider = new CaseAttachmentsDocumentProvider();
  const caseAttachmentContentProvider = new CaseAttachmentContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("kiwi-info", caseInfoProvider)
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("kiwi-diff", caseDiffProvider)
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("kiwi-plan-info", planInfoProvider)
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "kiwi-plan-local-mirror",
      planLocalMirrorStatusProvider
    )
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "kiwi-attachments",
      caseAttachmentsProvider
    )
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "kiwi-attachment",
      caseAttachmentContentProvider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kiwi.openRoot", async () => {
      provider.refreshListings();
      treeDataProvider.refresh();
      await vscode.commands.executeCommand("workbench.view.explorer");
      try {
        await vscode.commands.executeCommand("kiwiPlans.focus");
      } catch {
        // The view focus command is generated by VS Code at runtime.
      }
      return "kiwiPlans";
    }),
    vscode.commands.registerCommand(
      "kiwi.searchCases",
      async (injectedQuery?: unknown, injectedSelectionCaseId?: number) => {
        try {
          const providedQuery = typeof injectedQuery === "string" ? injectedQuery : undefined;
          if (
            providedQuery === undefined &&
            injectedSelectionCaseId !== undefined &&
            typeof injectedQuery !== "undefined"
          ) {
            return undefined;
          }
          const query =
            providedQuery ??
            (await vscode.window.showInputBox({
              prompt: "テストケース ID または summary を入力してください",
              placeHolder: "例: 501 / Login"
            }));
          if (query === undefined) {
            return undefined;
          }

          const items = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "テストケースを検索中..."
            },
            async () => {
              const { adapter, config } = await clientFactory();
              const plans = (await adapter.listPlans(config)).sort((left, right) => left.id - right.id);
              const planCases = await Promise.all(
                plans.map(async (plan) => ({
                  plan,
                  cases: (await adapter.listPlanCases(config, plan.id)).sort((left, right) => left.id - right.id)
                }))
              );
              return buildCaseSearchQuickPickItems(filterCaseSearchMatches(planCases, query));
            }
          );

          if (items.length === 0) {
            void vscode.window.showInformationMessage("一致するテストケースはありません。");
            return [];
          }

          const picked =
            injectedSelectionCaseId !== undefined
              ? items.find((item) => item.caseRef.id === injectedSelectionCaseId)
              : await pickCaseSearchItem(items);
          if (!picked) {
            return items.map((item) => ({
              label: item.label,
              description: item.description,
              detail: item.detail,
              caseId: item.caseRef.id,
              planId: item.plan.id
            }));
          }

          const uri = caseDocumentUri(picked.plan, picked.caseRef);
          await vscode.commands.executeCommand("vscode.open", uri);
          return {
            items: items.map((item) => ({
              label: item.label,
              description: item.description,
              detail: item.detail,
              caseId: item.caseRef.id,
              planId: item.plan.id
            })),
            opened: uri.toString()
          };
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand("kiwi.filterCases", async () => {
      try {
        const panel = await caseFilterController.open();
        return panel.title;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.configureBaseUrl", async (injectedInput?: string) => {
      const configuration = vscode.workspace.getConfiguration("kiwi");
      const input =
        injectedInput ??
        (await vscode.window.showInputBox({
          placeHolder: "https://kiwi.example.com/",
          prompt: "接続先の Kiwi base URL を入力してください",
          title: "Kiwi: Configure Base URL",
          value: configuration.get<string>("baseUrl") ?? ""
        }));
      if (input === undefined) {
        return undefined;
      }
      const normalized = normalizeBaseUrlInput(input);
      if (!normalized) {
        void vscode.window.showErrorMessage(
          "Kiwi base URL には http:// または https:// の URL を入力してください。"
        );
        return undefined;
      }
      await configuration.update("baseUrl", normalized, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage("Kiwi base URL を更新しました。");
      return normalized;
    }),
    vscode.commands.registerCommand("kiwi.configureUsername", async (injectedInput?: string) => {
      const input =
        injectedInput ??
        (await vscode.window.showInputBox({
          placeHolder: "admin",
          prompt: "Kiwi ユーザ名を入力してください",
          title: "Kiwi: Configure Username",
          value: (await readStoredUsername(context)) ?? ""
        }));
      if (input === undefined) {
        return undefined;
      }
      const normalized = normalizeSecretInput(input);
      if (!normalized) {
        void vscode.window.showErrorMessage("Kiwi ユーザ名は空にできません。");
        return undefined;
      }
      await storeUsername(context, normalized);
      void vscode.window.showInformationMessage("Kiwi ユーザ名を保存しました。");
      return normalized;
    }),
    vscode.commands.registerCommand("kiwi.configurePassword", async (injectedInput?: string) => {
      const input =
        injectedInput ??
        (await vscode.window.showInputBox({
          password: true,
          placeHolder: "Paste password",
          prompt: "Kiwi パスワードを入力してください",
          title: "Kiwi: Configure Password"
        }));
      if (input === undefined) {
        return undefined;
      }
      const normalized = normalizeSecretInput(input);
      if (!normalized) {
        void vscode.window.showErrorMessage("Kiwi パスワードは空にできません。");
        return undefined;
      }
      await storePassword(context, normalized);
      void vscode.window.showInformationMessage("Kiwi パスワードを保存しました。");
      return normalized;
    }),
    vscode.commands.registerCommand("kiwi.clearBaseUrl", async (confirmed?: boolean) => {
      const proceed =
        confirmed === true ||
        (await vscode.window.showWarningMessage(
          "Base URL をクリアしますか？",
          { modal: true },
          "クリア"
        )) === "クリア";
      if (!proceed) {
        return false;
      }
      await vscode.workspace
        .getConfiguration("kiwi")
        .update("baseUrl", "", vscode.ConfigurationTarget.Global);
      provider.refreshListings();
      treeDataProvider.refresh();
      void vscode.window.showInformationMessage("Kiwi base URL をクリアしました。");
      return true;
    }),
    vscode.commands.registerCommand("kiwi.clearUsername", async (confirmed?: boolean) => {
      const proceed =
        confirmed === true ||
        (await vscode.window.showWarningMessage(
          "ユーザ名をクリアしますか？",
          { modal: true },
          "クリア"
        )) === "クリア";
      if (!proceed) {
        return false;
      }
      await clearUsername(context);
      void vscode.window.showInformationMessage("Kiwi ユーザ名をクリアしました。");
      return true;
    }),
    vscode.commands.registerCommand("kiwi.clearPassword", async (confirmed?: boolean) => {
      const proceed =
        confirmed === true ||
        (await vscode.window.showWarningMessage(
          "パスワードをクリアしますか？",
          { modal: true },
          "クリア"
        )) === "クリア";
      if (!proceed) {
        return false;
      }
      await clearPassword(context);
      void vscode.window.showInformationMessage("Kiwi パスワードをクリアしました。");
      return true;
    }),
    vscode.commands.registerCommand("kiwi.clearConfiguration", async (confirmed?: boolean) => {
      const proceed =
        confirmed === true ||
        (await vscode.window.showWarningMessage(
          "Kiwi の接続設定をすべてクリアしますか？",
          { modal: true },
          "クリア"
        )) === "クリア";
      if (!proceed) {
        return false;
      }
      await vscode.workspace
        .getConfiguration("kiwi")
        .update("baseUrl", "", vscode.ConfigurationTarget.Global);
      await clearCredentials(context);
      provider.refreshListings();
      treeDataProvider.refresh();
      void vscode.window.showInformationMessage("Kiwi 接続設定をすべてクリアしました。");
      return true;
    }),
    vscode.commands.registerCommand("kiwi.openTreeItem", async (uri?: vscode.Uri) => {
      if (!uri) {
        return;
      }
      await vscode.commands.executeCommand("vscode.open", uri);
    }),
    vscode.commands.registerCommand("kiwi.refreshCaseDocument", async () => {
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document.uri;
      if (!editor || !uri || !isCaseDocumentUri(uri)) {
        void vscode.window.showInformationMessage(
          "Open a Kiwi case document before refreshing."
        );
        return false;
      }
      if (editor.document.isDirty) {
        void vscode.window.showErrorMessage(
          "Unsaved changes are present. Save or revert the document before refreshing."
        );
        return false;
      }

      try {
        await provider.refreshCaseDocument(uri);
        await vscode.commands.executeCommand("workbench.action.files.revert");
        return true;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return false;
      }
    }),
    vscode.commands.registerCommand("kiwi.showCaseDiff", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseDiffTarget(target, provider, clientFactory);
      if (!resolved) {
        return;
      }

      const title = renderCaseDiffTitle(resolved.caseData.summary);
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
      const localUri = caseDiffUri("local", resolved.plan, resolved.caseRef, requestId);
      const remoteUri = caseDiffUri("remote", resolved.plan, resolved.caseRef, requestId);
      caseDiffProvider.setContent(localUri, renderCaseDiffDocument({ body: resolved.localBody }));
      caseDiffProvider.setContent(remoteUri, renderCaseDiffDocument({ body: resolved.remoteBody }));
      await vscode.commands.executeCommand("vscode.diff", localUri, remoteUri, title, {
        preview: false
      });
      return {
        localUri: localUri.toString(),
        remoteUri: remoteUri.toString(),
        title
      };
    }),
    vscode.commands.registerCommand("kiwi.showCaseHistoryDiff", async (target?: KiwiPlansTreeNode, historyId?: number) => {
      const resolvedTarget = target?.kind === "case" ? target : undefined;
      if (!resolvedTarget) {
        void vscode.window.showInformationMessage("Select a Kiwi case first.");
        return undefined;
      }

      try {
        const { adapter, config } = await clientFactory();
        const history = await adapter.getCaseHistory(config, resolvedTarget.caseRef.id);
        const selectedHistoryId = historyId ?? (await pickCaseHistoryId(history));
        if (selectedHistoryId === undefined) {
          return undefined;
        }

        const [historyVersion, latestCase] = await Promise.all([
          adapter.getCaseHistoryVersion(config, resolvedTarget.caseRef.id, selectedHistoryId),
          adapter.getCaseBody(config, resolvedTarget.caseRef.id, resolvedTarget.plan.id)
        ]);
        const title = `${resolvedTarget.caseRef.summary} (History ${selectedHistoryId} ↔ Latest)`;
        const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
        const historyUri = caseDiffUri("history", resolvedTarget.plan, resolvedTarget.caseRef, requestId);
        const latestUri = caseDiffUri("latest", resolvedTarget.plan, resolvedTarget.caseRef, requestId);
        caseDiffProvider.setContent(historyUri, renderCaseDiffDocument({ body: historyVersion.text }));
        caseDiffProvider.setContent(latestUri, renderCaseDiffDocument({ body: latestCase.text }));
        await vscode.commands.executeCommand("vscode.diff", historyUri, latestUri, title, {
          preview: false
        });
        return {
          historyUri: historyUri.toString(),
          latestUri: latestUri.toString(),
          title
        };
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.showCaseInfo", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseInfoTarget(target, clientFactory);
      if (!resolved) {
        return;
      }

      const { plan, caseRef, caseData, versionToken } = resolved;
      const uri = caseInfoUri(plan, caseRef);
      caseInfoProvider.setContent(
        uri,
        renderCaseInfoDocument({
          caseData,
          versionToken
        })
      );
      await vscode.commands.executeCommand("vscode.open", uri);
      return uri.toString();
    }),
    vscode.commands.registerCommand("kiwi.editCaseMetadata", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseMetadataTarget(target);
      if (!resolved) {
        return undefined;
      }

      const panel = await metadataEditorController.open(resolved);
      return panel.title;
    }),
    vscode.commands.registerCommand("kiwi.createCase", async (target?: KiwiPlansTreeNode) => {
      const resolved = resolveCaseCreateTarget(target);
      if (!resolved) {
        return undefined;
      }

      const panel = await metadataEditorController.open(resolved);
      return panel.title;
    }),
    vscode.commands.registerCommand(
      "kiwi.addExistingCaseToPlan",
      async (
        target?: KiwiPlansTreeNode,
        injectedQuery?: string,
        injectedSelectionCaseId?: number
      ) => {
        const resolved = resolveAddExistingCaseToPlanTarget(target);
        if (!resolved) {
          return undefined;
        }

        try {
          const query =
            injectedQuery ??
            (await vscode.window.showInputBox({
              prompt: "追加する既存テストケース ID または summary を入力してください",
              placeHolder: "例: 501 / Login"
            }));
          if (query === undefined) {
            return undefined;
          }

          const items = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "既存テストケースを検索中..."
            },
            async () => {
              const { adapter, config } = await clientFactory();
              const plans = (await adapter.listPlans(config)).sort((left, right) => left.id - right.id);
              const planCases = await Promise.all(
                plans.map(async (plan) => ({
                  plan,
                  cases: (await adapter.listPlanCases(config, plan.id)).sort((left, right) => left.id - right.id)
                }))
              );
              return buildExistingCaseToPlanQuickPickItems(
                buildExistingCaseToPlanEntries(planCases, resolved.plan.id, query)
              );
            }
          );

          if (items.length === 0) {
            void vscode.window.showInformationMessage(
              "追加できる既存テストケースは見つかりませんでした。"
            );
            return [];
          }

          const picked =
            injectedSelectionCaseId !== undefined
              ? items.find((item) => item.entry.caseId === injectedSelectionCaseId)
              : await pickExistingCaseToPlanItem(items);
          if (!picked) {
            return items.map((item) => serializeExistingCaseToPlanItem(item));
          }

          const { adapter, config } = await clientFactory();
          const currentCases = await adapter.listPlanCases(config, resolved.plan.id);
          if (currentCases.some((caseRef) => caseRef.id === picked.entry.caseId)) {
            void vscode.window.showInformationMessage(
              "このテストケースは既にこの計画に含まれています。"
            );
            return {
              planId: resolved.plan.id,
              caseId: picked.entry.caseId,
              summary: picked.entry.summary,
              alreadyExists: true
            };
          }

          await adapter.addCaseToPlan(config, resolved.plan.id, picked.entry.caseId);
          provider.refreshListings();
          treeDataProvider.refresh();
          void vscode.window.showInformationMessage(
            "既存テストケースをこの計画に追加しました。"
          );
          return {
            planId: resolved.plan.id,
            caseId: picked.entry.caseId,
            summary: picked.entry.summary
          };
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.removeCaseFromPlan",
      async (
        target?: KiwiPlansTreeNode,
        injectedSelectionCaseId?: number,
        injectedConfirmation?: boolean
      ) => {
        const resolved = resolveAddExistingCaseToPlanTarget(target);
        if (!resolved) {
          return undefined;
        }

        try {
          const { adapter, config } = await clientFactory();
          const items = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "この計画のテストケースを取得中..."
            },
            async () =>
              buildRemoveCaseFromPlanQuickPickItems(
                resolved.plan,
                await adapter.listPlanCases(config, resolved.plan.id)
              )
          );

          if (items.length === 0) {
            void vscode.window.showInformationMessage(
              "この計画に含まれるテストケースはありません。"
            );
            return [];
          }

          const picked =
            injectedSelectionCaseId !== undefined
              ? items.find((item) => item.caseRef.id === injectedSelectionCaseId)
              : await pickRemoveCaseFromPlanItem(items);
          if (!picked) {
            return items.map((item) => serializeRemoveCaseFromPlanItem(item));
          }

          const proceed =
            injectedConfirmation ??
            ((await vscode.window.showWarningMessage(
              `この計画からテストケース ${picked.caseRef.id} - ${picked.caseRef.summary} を外しますか？`,
              { modal: true },
              "外す"
            )) === "外す");
          if (!proceed) {
            return {
              planId: resolved.plan.id,
              caseId: picked.caseRef.id,
              summary: picked.caseRef.summary,
              cancelled: true
            };
          }

          await adapter.removeCaseFromPlan(config, resolved.plan.id, picked.caseRef.id);
          provider.refreshListings();
          treeDataProvider.refresh();
          void vscode.window.showInformationMessage(
            "テストケースをこの計画から外しました。"
          );
          return {
            planId: resolved.plan.id,
            caseId: picked.caseRef.id,
            summary: picked.caseRef.summary
          };
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand("kiwi.duplicateCase", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseDuplicateTarget(target);
      if (!resolved) {
        return undefined;
      }

      const panel = await metadataEditorController.open(resolved);
      return panel.title;
    }),
    vscode.commands.registerCommand(
      "kiwi.manageCaseExecutionsAcrossRuns",
      async (target?: KiwiPlansTreeNode) => {
        const resolved = await resolveCaseExecutionTarget(target);
        if (!resolved) {
          return undefined;
        }

        try {
          const panel = await caseExecutionBoardController.open({
            plan: resolved.plan,
            caseRef: resolved.caseRef
          });
          return panel.title;
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.recordCaseExecutionResult",
      async (target?: KiwiPlansTreeNode, injectedExecutionId?: number) => {
        const resolved = await resolveCaseExecutionTarget(target);
        if (!resolved) {
          return undefined;
        }

        try {
          const { adapter, config } = await clientFactory();
          const executions = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "テスト実行を取得中..."
            },
            async () => adapter.listCaseExecutions(config, resolved.caseRef.id)
          );
          if (executions.length === 0) {
            void vscode.window.showInformationMessage(
              "このテストケースを含むテスト実行はありません。"
            );
            return [];
          }

          const items = buildExecutionQuickPickItems(executions);
          const picked =
            injectedExecutionId !== undefined
              ? items.find((item) => item.execution.id === injectedExecutionId)
              : executions.length === 1
                ? items[0]
                : await pickExecutionItem(items);
          if (!picked) {
            return items.map(serializeExecutionItem);
          }

          const panel = await executionResultController.open({
            plan: resolved.plan,
            caseRef: resolved.caseRef,
            execution: picked.execution
          });
          return panel.title;
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand("kiwi.openTestRunDashboard", async () => {
      try {
        const panel = await testRunDashboardController.open();
        return panel?.title;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
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
        openLabel: "添付を追加"
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
          files.length === 1 ? "添付完了" : `${files.length} file(s) attached.`
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
            `添付を選択: ${resolved.caseRef.summary}`
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
            `添付を選択: ${resolved.caseRef.summary}`
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
              "This attachment is not supported for inline editor view. Use '添付をブラウザで表示'."
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
    ),
    vscode.commands.registerCommand("kiwi.showPlanInfo", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolvePlanInfoTarget(target, clientFactory);
      if (!resolved) {
        return;
      }

      const uri = planInfoUri(resolved.plan);
      planInfoProvider.setContent(
        uri,
        renderPlanInfoDocument({
          plan: resolved.planData
        })
      );
      await vscode.commands.executeCommand("vscode.open", uri);
      return uri.toString();
    }),
    vscode.commands.registerCommand(
      "kiwi.downloadPlanToLocalMirror",
      async (
        target?: KiwiPlansTreeNode,
        forceOverwrite?: boolean,
        skipConfirmation?: boolean
      ) => {
        const resolvedTarget = resolvePlanMirrorTarget(target);
        const service = createLocalMirrorService(clientFactory);
        if (!resolvedTarget || !service) {
          return undefined;
        }

        try {
          if (!forceOverwrite) {
            const rows = await service.getPlanMirrorStatus(resolvedTarget.plan);
            const requiresOverwrite = rows.some(
              (row) => row.status === "modified locally" || row.status === "conflict"
            );
            if (requiresOverwrite) {
              if (skipConfirmation === true) {
                forceOverwrite = false;
              } else {
              const confirmed =
                (await vscode.window.showWarningMessage(
                  "配下のローカルミラーに未反映変更があります。Kiwi の最新本文でまとめて上書きしますか？",
                  { modal: true },
                  "上書きする"
                )) === "上書きする";
              forceOverwrite = confirmed;
              }
            }
          }

          const result = await service.downloadPlanCases(resolvedTarget.plan, {
            force: forceOverwrite
          });
          void vscode.window.showInformationMessage(
            `Plan local mirror sync finished. downloaded=${result.downloaded}, overwritten=${result.overwritten}, skipped=${result.skipped}, failed=${result.failed}`
          );
          return result;
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.showPlanLocalMirrorStatus",
      async (target?: KiwiPlansTreeNode) => {
        const resolvedTarget = resolvePlanMirrorTarget(target);
        const service = createLocalMirrorService(clientFactory);
        if (!resolvedTarget || !service) {
          return undefined;
        }

        try {
          const rows = await service.getPlanMirrorStatus(resolvedTarget.plan);
          const uri = planLocalMirrorStatusUri(resolvedTarget.plan);
          planLocalMirrorStatusProvider.setContent(
            uri,
            renderPlanLocalMirrorStatusDocument({
              plan: resolvedTarget.plan,
              rows
            })
          );
          await vscode.commands.executeCommand("vscode.open", uri);
          return uri.toString();
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand("kiwi.openInBrowser", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseBrowserTarget(target, clientFactory);
      if (!resolved) {
        return;
      }

      await vscode.env.openExternal(resolved.uri);
      return resolved.uri.toString();
    }),
    vscode.commands.registerCommand("kiwi.openPlanInBrowser", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolvePlanBrowserTarget(target, clientFactory);
      if (!resolved) {
        return;
      }

      await vscode.env.openExternal(resolved.uri);
      return resolved.uri.toString();
    }),
    vscode.commands.registerCommand(
      "kiwi.downloadCaseToLocalMirror",
      async (target?: KiwiPlansTreeNode, forceOverride?: boolean) => {
      const resolvedTarget = resolveMirrorTarget(target);
      const service = createLocalMirrorService(clientFactory);
      if (!resolvedTarget || !service) {
        return;
      }

      try {
        if (!forceOverride) {
          try {
            const result = await service.downloadCase(resolvedTarget);
            await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(result.localPath));
            void vscode.window.showInformationMessage("Case downloaded to local mirror.");
            return result;
          } catch (error) {
            if (
              error instanceof KiwiError &&
              (error.code === "ValidationFailed" || error.code === "ConflictDetected")
            ) {
              const confirmed =
                (await vscode.window.showWarningMessage(
                  "ローカルミラーの未反映変更を破棄して、Kiwi の最新本文で上書きしますか？",
                  { modal: true },
                  "上書きする"
                )) === "上書きする";
              if (!confirmed) {
                return undefined;
              }
              forceOverride = true;
            } else {
              throw error;
            }
          }
        }

        const result = await service.downloadCase(resolvedTarget, { force: forceOverride });
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(result.localPath));
        void vscode.window.showInformationMessage("Case downloaded to local mirror.");
        return result;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.compareLocalMirror", async (target?: KiwiPlansTreeNode) => {
      const resolvedTarget = resolveMirrorTarget(target);
      const service = createLocalMirrorService(clientFactory);
      if (!resolvedTarget || !service) {
        return;
      }

      try {
        const result = await service.compareCase(resolvedTarget);
        const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
        const localUri = localMirrorDiffUri("local", resolvedTarget.plan, resolvedTarget.caseRef, requestId);
        const remoteUri = localMirrorDiffUri("remote", resolvedTarget.plan, resolvedTarget.caseRef, requestId);
        const title = `${resolvedTarget.caseRef.summary} (Local Mirror ↔ Remote)`;
        caseDiffProvider.setContent(localUri, renderCaseDiffDocument({ body: result.localBody }));
        caseDiffProvider.setContent(remoteUri, renderCaseDiffDocument({ body: result.remoteBody }));
        await vscode.commands.executeCommand("vscode.diff", remoteUri, localUri, title, {
          preview: false
        });
        void vscode.window.showInformationMessage(`Local mirror status: ${result.status}.`);
        return {
          localUri: localUri.toString(),
          remoteUri: remoteUri.toString(),
          title,
          status: result.status,
          localPath: result.localPath
        };
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.uploadLocalMirror", async (target?: KiwiPlansTreeNode) => {
      const resolvedTarget = resolveMirrorTarget(target);
      const service = createLocalMirrorService(clientFactory);
      if (!resolvedTarget || !service) {
        return;
      }

      try {
        const result = await service.uploadCase(resolvedTarget);
        const refreshResult = await refreshOpenedCaseDocumentAfterLocalMirrorUpload(
          provider,
          resolvedTarget
        );
        if (refreshResult === "refreshed") {
          void vscode.window.showInformationMessage(
            "Local mirror uploaded. Opened case document was refreshed."
          );
        } else if (refreshResult === "dirty") {
          void vscode.window.showInformationMessage(
            "Local mirror uploaded. Opened case document was not refreshed because it has unsaved changes."
          );
        } else {
          void vscode.window.showInformationMessage("Local mirror uploaded.");
        }
        return result;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.revealLocalMirror", async (target?: KiwiPlansTreeNode) => {
      const resolvedTarget = resolveMirrorTarget(target);
      const service = createLocalMirrorService(clientFactory);
      if (!resolvedTarget || !service) {
        return;
      }

      try {
        const localPath = await service.revealLocalMirror(resolvedTarget);
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(localPath));
        return localPath;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.refreshPlans", async () => {
      provider.refreshListings();
      treeDataProvider.refresh();
      return "kiwiPlans";
    }),
    vscode.commands.registerCommand("kiwi.clearRuntimeLogs", async () => {
      if (!isDebugF5Runtime()) {
        void vscode.window.showInformationMessage("Runtime logs are available only in debug-f5 mode.");
        return 0;
      }

      const directory = logger.getResolvedRuntimeLogDirectory();
      if (!directory) {
        void vscode.window.showInformationMessage("Runtime log path is not resolved yet.");
        return 0;
      }

      let removed = 0;
      try {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            await rm(vscode.Uri.joinPath(vscode.Uri.file(directory), entry.name).fsPath, {
              force: true
            });
            removed += 1;
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      logger.resetRuntimeLogState();
      void vscode.window.showInformationMessage(`Removed ${removed} runtime log file(s).`);
      return removed;
    }),
    vscode.commands.registerCommand("kiwi.revealRuntimeLogs", async () => {
      if (!isDebugF5Runtime()) {
        void vscode.window.showInformationMessage("Runtime logs are available only in debug-f5 mode.");
        return;
      }

      const directory = logger.getResolvedRuntimeLogDirectory();
      if (!directory) {
        void vscode.window.showInformationMessage("Runtime log path is not resolved yet.");
        return;
      }

      await vscode.env.openExternal(vscode.Uri.file(directory));
      return directory;
    }),
    vscode.commands.registerCommand("kiwi.__test.getResolvedRuntimeLogDirectory", async () => {
      return logger.getResolvedRuntimeLogDirectory();
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.searchCases",
      async (query: string, selectionCaseId?: number) => {
        return vscode.commands.executeCommand("kiwi.searchCases", query, selectionCaseId);
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.filterCases", async () => {
      return vscode.commands.executeCommand("kiwi.filterCases");
    }),
    vscode.commands.registerCommand("kiwi.__test.getCaseFilterState", async () => {
      return caseFilterController.getStateForTest();
    }),
    vscode.commands.registerCommand("kiwi.__test.submitCaseFilter", async (formState) => {
      return caseFilterController.searchForTest(formState);
    }),
    vscode.commands.registerCommand("kiwi.__test.openCaseFilterResult", async (caseId: number) => {
      return caseFilterController.openResultForTest(caseId);
    }),
    vscode.commands.registerCommand("kiwi.__test.getPlanTreeSnapshot", async () => {
      return treeDataProvider.snapshot();
    }),
    vscode.commands.registerCommand("kiwi.__test.showCaseInfo", async () => {
      const target: KiwiPlansTreeNode = {
        kind: "case",
        plan: {
          id: 100,
          name: "Regression"
        },
        caseRef: {
          id: 501,
          summary: "Login works"
        }
      };
      return vscode.commands.executeCommand("kiwi.showCaseInfo", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.editCaseMetadata", async () => {
      const target: KiwiPlansTreeNode = {
        kind: "case",
        plan: {
          id: 100,
          name: "Regression"
        },
        caseRef: {
          id: 501,
          summary: "Login works"
        }
      };
      return vscode.commands.executeCommand("kiwi.editCaseMetadata", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.createCase", async () => {
      const target: KiwiPlansTreeNode = {
        kind: "plan",
        plan: {
          id: 100,
          name: "Regression"
        }
      };
      return vscode.commands.executeCommand("kiwi.createCase", target);
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.addExistingCaseToPlan",
      async (query: string, selectionCaseId?: number, targetPlanId = 100) => {
        const target: KiwiPlansTreeNode = {
          kind: "plan",
          plan: {
            id: targetPlanId,
            name: targetPlanId === 100 ? "Regression" : "Secondary"
          }
        };
        return vscode.commands.executeCommand(
          "kiwi.addExistingCaseToPlan",
          target,
          query,
          selectionCaseId
        );
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.removeCaseFromPlan",
      async (
        args: {
          selectionCaseId?: number;
          confirmed?: boolean;
          targetPlanId?: number;
        } = {}
      ) => {
        const targetPlanId = args.targetPlanId ?? 100;
        const target: KiwiPlansTreeNode = {
          kind: "plan",
          plan: {
            id: targetPlanId,
            name: targetPlanId === 100 ? "Regression" : "Secondary"
          }
        };
        return vscode.commands.executeCommand(
          "kiwi.removeCaseFromPlan",
          target,
          args.selectionCaseId,
          args.confirmed
        );
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.duplicateCase", async () => {
      const target: KiwiPlansTreeNode = {
        kind: "case",
        plan: {
          id: 100,
          name: "Regression"
        },
        caseRef: {
          id: 501,
          summary: "Login works"
        }
      };
      return vscode.commands.executeCommand("kiwi.duplicateCase", target);
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.manageCaseExecutionsAcrossRuns",
      async (caseId = 501, summary = "Login works", planId = 100, planName = "Regression") => {
        const target: KiwiPlansTreeNode = {
          kind: "case",
          plan: {
            id: planId,
            name: planName
          },
          caseRef: {
            id: caseId,
            summary
          }
        };
        return vscode.commands.executeCommand("kiwi.manageCaseExecutionsAcrossRuns", target);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.getCaseExecutionBoardState",
      async (caseId = 501) => {
        return caseExecutionBoardController.getStateForTest(caseId);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.createCaseExecutionBoardRun",
      async (caseId: number, payload: { planId: number; summary: string; buildId: number; manager: string }) => {
        return caseExecutionBoardController.createRunForTest(caseId, payload);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.addCaseExecutionBoardRun",
      async (caseId: number, runId: number) => {
        return caseExecutionBoardController.addRunForTest(caseId, runId);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.saveCaseExecutionBoardRow",
      async (caseId: number, runId: number, status: string, comment: string) => {
        return caseExecutionBoardController.saveRowForTest(caseId, runId, status, comment);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.openCaseExecutionBoardRow",
      async (caseId: number, runId: number) => {
        return caseExecutionBoardController.openRowForTest(caseId, runId);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.recordCaseExecutionResult",
      async (executionId?: number, caseId = 501, summary = "Login works") => {
        const target: KiwiPlansTreeNode = {
          kind: "case",
          plan: {
            id: 100,
            name: "Regression"
          },
          caseRef: {
            id: caseId,
            summary
          }
        };
        return vscode.commands.executeCommand(
          "kiwi.recordCaseExecutionResult",
          target,
          executionId
        );
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.getExecutionResultState", async (executionId: number) => {
      return executionResultController.getStateForTest(executionId);
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.submitExecutionResult",
      async (executionId: number, formState) => {
        return executionResultController.submitForTest(executionId, formState);
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.openTestRunDashboard", async () => {
      return vscode.commands.executeCommand("kiwi.openTestRunDashboard");
    }),
    vscode.commands.registerCommand("kiwi.__test.getTestRunDashboardState", async () => {
      return testRunDashboardController.getStateForTest();
    }),
    vscode.commands.registerCommand("kiwi.__test.selectDashboardRun", async (runId: number) => {
      return testRunDashboardController.selectRunForTest(runId);
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.saveDashboardRow",
      async (executionId: number, status: string, comment: string) => {
        return testRunDashboardController.saveRowForTest(executionId, status, comment);
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.openDashboardRow", async (executionId: number) => {
      return testRunDashboardController.openRowForTest(executionId);
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.createDashboardRun",
      async (payload: { summary: string; planId: number; buildId: number; manager: string }) => {
        return testRunDashboardController.createRunForTest(payload);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.addCaseToDashboardRun",
      async (caseId: number) => {
        return testRunDashboardController.addCaseToSelectedRunForTest(caseId);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.bulkUpdateDashboardRows",
      async (executionIds: number[], status: string) => {
        return testRunDashboardController.bulkUpdateForTest(executionIds, status);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.getMetadataEditorState",
      async (identifier = 501, mode: MetadataEditorMode = "edit") => {
        return metadataEditorController.getStateForTest(identifier, mode);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.submitMetadataEditor",
      async (formState, identifier = 501, mode: MetadataEditorMode = "edit") => {
        return metadataEditorController.submitForTest(identifier, formState, mode);
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.readCaseState", async (caseId: number) => {
      const state = await clientFactory();
      return state.adapter.getCase(state.config, caseId);
    }),
    vscode.commands.registerCommand("kiwi.__test.showCaseAttachments", async () => {
      const target: KiwiPlansTreeNode = {
        kind: "case",
        plan: {
          id: 100,
          name: "Regression"
        },
        caseRef: {
          id: 501,
          summary: "Login works"
        }
      };
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
        const target: KiwiPlansTreeNode = {
          kind: "case",
          plan: {
            id: 100,
            name: "Regression"
          },
          caseRef: {
            id: 501,
            summary: "Login works"
          }
        };
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
        const fallbackTarget: KiwiPlansTreeNode = {
          kind: "case",
          plan: { id: 100, name: "Regression" },
          caseRef: { id: 501, summary: "Login works" }
        };
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
      const target: KiwiPlansTreeNode = {
        kind: "plan",
        plan: {
          id: 100,
          name: "Regression"
        }
      };
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
      const target: KiwiPlansTreeNode = {
        kind: "plan",
        plan: {
          id: 100,
          name: "Regression"
        }
      };
      return vscode.commands.executeCommand(
        "kiwi.downloadPlanToLocalMirror",
        target,
        forceOverwrite,
        skipConfirmation
      );
    }),
    vscode.commands.registerCommand("kiwi.__test.showPlanLocalMirrorStatus", async () => {
      const target: KiwiPlansTreeNode = {
        kind: "plan",
        plan: {
          id: 100,
          name: "Regression"
        }
      };
      return vscode.commands.executeCommand("kiwi.showPlanLocalMirrorStatus", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.showCaseDiff", async () => {
      const target: KiwiPlansTreeNode = {
        kind: "case",
        plan: {
          id: 100,
          name: "Regression"
        },
        caseRef: {
          id: 501,
          summary: "Login works"
        }
      };
      return vscode.commands.executeCommand("kiwi.showCaseDiff", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.showCaseHistoryDiff", async (historyId: number) => {
      const target: KiwiPlansTreeNode = {
        kind: "case",
        plan: {
          id: 100,
          name: "Regression"
        },
        caseRef: {
          id: 501,
          summary: "Login works"
        }
      };
      return vscode.commands.executeCommand("kiwi.showCaseHistoryDiff", target, historyId);
    }),
    vscode.commands.registerCommand("kiwi.__test.openInBrowser", async (target?: KiwiPlansTreeNode) => {
      const fallbackTarget: KiwiPlansTreeNode = {
        kind: "case",
        plan: {
          id: 100,
          name: "Regression"
        },
        caseRef: {
          id: 501,
          summary: "Login works"
        }
      };
      const resolved = await resolveCaseBrowserTarget(
        target ?? activeCaseNode() ?? fallbackTarget,
        clientFactory
      );
      return resolved?.uri.toString();
    }),
    vscode.commands.registerCommand("kiwi.__test.openPlanInBrowser", async () => {
      const target: KiwiPlansTreeNode = {
        kind: "plan",
        plan: {
          id: 100,
          name: "Regression"
        }
      };
      const resolved = await resolvePlanBrowserTarget(target, clientFactory);
      return resolved?.uri.toString();
    }),
    vscode.commands.registerCommand("kiwi.__test.downloadLocalMirror", async (forceOverride?: boolean) => {
      const target: KiwiPlansTreeNode = {
        kind: "case",
        plan: { id: 100, name: "Regression" },
        caseRef: { id: 501, summary: "Login works" }
      };
      return vscode.commands.executeCommand("kiwi.downloadCaseToLocalMirror", target, forceOverride);
    }),
    vscode.commands.registerCommand("kiwi.__test.compareLocalMirror", async () => {
      const target: KiwiPlansTreeNode = {
        kind: "case",
        plan: { id: 100, name: "Regression" },
        caseRef: { id: 501, summary: "Login works" }
      };
      return vscode.commands.executeCommand("kiwi.compareLocalMirror", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.uploadLocalMirror", async () => {
      const target: KiwiPlansTreeNode = {
        kind: "case",
        plan: { id: 100, name: "Regression" },
        caseRef: { id: 501, summary: "Login works" }
      };
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
      const target: KiwiPlansTreeNode = {
        kind: "case",
        plan: { id: 100, name: "Regression" },
        caseRef: { id: 501, summary: "Login works" }
      };
      return vscode.commands.executeCommand("kiwi.revealLocalMirror", target);
    })
  );
}

export function deactivate(): void {
  providerRegistration?.dispose();
}

class CaseInfoDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "# Case Info\n\nMetadata is not available.";
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }
}

class CaseDiffDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }
}

class PlanInfoDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "# Plan Info\n\nPlan detail is not available.";
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }
}

class PlanLocalMirrorStatusDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "# Local Mirror Status\n\nStatus is not available.";
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }
}

class CaseAttachmentsDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return (
      this.contents.get(uri.toString()) ?? "# Attachments\n\nAttachments are not available."
    );
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }
}

class CaseAttachmentContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }
}

async function openAttachmentInEditor(
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

class AttachmentUploadService {
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

class KiwiPlansDragAndDropController
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
      const error = new KiwiError("ValidationFailed", "ケースにドロップしてください。");
      await this.logDropFailure(error, target);
      throw error;
    }

    const files = await extractDroppedFiles(dataTransfer);
    if (files.length === 0) {
      const error = new KiwiError("ValidationFailed", "ドロップされたファイルを取得できませんでした。");
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
            uploaded === 1 ? "添付完了" : `${uploaded} file(s) attached.`
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

async function resolveCaseInfoTarget(
  target: KiwiPlansTreeNode | undefined,
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>
): Promise<
  | {
      plan: { id: number; name: string };
      caseRef: { id: number; summary: string };
      caseData: Awaited<ReturnType<ReturnType<typeof createAdapter>["getCase"]>>;
      versionToken: string;
    }
  | undefined
> {
  if (!target || target.kind !== "case") {
    return undefined;
  }

  try {
    const { adapter, config } = await clientFactory();
    const [caseData, history] = await Promise.all([
      adapter.getCase(config, target.caseRef.id, target.plan.id),
      adapter.getCaseHistory(config, target.caseRef.id)
    ]);
    return {
      plan: target.plan,
      caseRef: target.caseRef,
      caseData,
      versionToken: deriveVersionToken(history)
    };
  } catch (error) {
    void vscode.window.showErrorMessage(humanMessage(error));
    return undefined;
  }
}

async function resolveCaseMetadataTarget(
  target: KiwiPlansTreeNode | undefined
): Promise<MetadataEditorTarget | undefined> {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }
  return {
    mode: "edit",
    plan: resolvedTarget.plan,
    caseRef: resolvedTarget.caseRef
  };
}

function resolveCaseCreateTarget(
  target: KiwiPlansTreeNode | undefined
): MetadataEditorTarget | undefined {
  if (!target || target.kind !== "plan") {
    void vscode.window.showInformationMessage("Select a Kiwi plan first.");
    return undefined;
  }
  return {
    mode: "create",
    plan: target.plan
  };
}

function resolveAddExistingCaseToPlanTarget(
  target: KiwiPlansTreeNode | undefined
): Extract<KiwiPlansTreeNode, { kind: "plan" }> | undefined {
  if (!target || target.kind !== "plan") {
    void vscode.window.showInformationMessage("Select a Kiwi plan first.");
    return undefined;
  }
  return target;
}

function resolveCaseDuplicateTarget(
  target: KiwiPlansTreeNode | undefined
): MetadataEditorTarget | undefined {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }
  return {
    mode: "duplicate",
    plan: resolvedTarget.plan,
    caseRef: resolvedTarget.caseRef
  };
}

async function resolveCaseExecutionTarget(
  target: KiwiPlansTreeNode | undefined
): Promise<Extract<KiwiPlansTreeNode, { kind: "case" }> | undefined> {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }
  return resolvedTarget;
}

async function resolveCaseAttachmentTarget(
  target: KiwiPlansTreeNode | undefined
): Promise<Extract<KiwiPlansTreeNode, { kind: "case" }> | undefined> {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }
  return resolvedTarget;
}

async function resolvePlanInfoTarget(
  target: KiwiPlansTreeNode | undefined,
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>
): Promise<
  | {
      plan: { id: number; name: string };
      planData: Awaited<ReturnType<ReturnType<typeof createAdapter>["getPlan"]>>;
    }
  | undefined
> {
  if (!target || target.kind !== "plan") {
    void vscode.window.showInformationMessage("Select a Kiwi plan first.");
    return undefined;
  }

  try {
    const { adapter, config } = await clientFactory();
    const planData = await adapter.getPlan(config, target.plan.id);
    return {
      plan: target.plan,
      planData
    };
  } catch (error) {
    void vscode.window.showErrorMessage(humanMessage(error));
    return undefined;
  }
}

async function resolveCaseDiffTarget(
  target: KiwiPlansTreeNode | undefined,
  provider: KiwiFileSystemProvider,
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>
): Promise<
  | {
      plan: { id: number; name: string };
      caseRef: { id: number; summary: string };
      caseData: KiwiCaseBody;
      localBody: string;
      remoteBody: string;
    }
  | undefined
> {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }

  try {
    const { adapter, config } = await clientFactory();
    const caseData = await adapter.getCaseBody(
      config,
      resolvedTarget.caseRef.id,
      resolvedTarget.plan.id
    );
    return {
      plan: resolvedTarget.plan,
      caseRef: resolvedTarget.caseRef,
      caseData,
      localBody: await resolveLocalDiffBody(resolvedTarget, provider),
      remoteBody: caseData.text
    };
  } catch (error) {
    void vscode.window.showErrorMessage(humanMessage(error));
    return undefined;
  }
}

async function resolveCaseBrowserTarget(
  target: KiwiPlansTreeNode | undefined,
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>
): Promise<{ uri: vscode.Uri } | undefined> {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }

  try {
    const { config } = await clientFactory();
    return {
      uri: vscode.Uri.parse(buildCaseBrowserUri(config.baseUrl, resolvedTarget.caseRef.id))
    };
  } catch (error) {
    void vscode.window.showErrorMessage(humanMessage(error));
    return undefined;
  }
}

async function resolvePlanBrowserTarget(
  target: KiwiPlansTreeNode | undefined,
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>
): Promise<{ uri: vscode.Uri } | undefined> {
  if (!target || target.kind !== "plan") {
    void vscode.window.showInformationMessage("Select a Kiwi plan first.");
    return undefined;
  }

  try {
    const { config } = await clientFactory();
    return {
      uri: vscode.Uri.parse(buildPlanBrowserUri(config.baseUrl, target.plan.id))
    };
  } catch (error) {
    void vscode.window.showErrorMessage(humanMessage(error));
    return undefined;
  }
}

async function resolveLocalDiffBody(
  target: Extract<KiwiPlansTreeNode, { kind: "case" }>,
  provider: KiwiFileSystemProvider
): Promise<string> {
  const uri = vscode.Uri.parse(
    `kiwi:/plans/${planDirectoryName(target.plan)}/cases/${caseFileName(target.caseRef)}`
  );
  const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
  if (openDocument) {
    return openDocument.getText();
  }

  const cached = provider.getCachedCaseDocument(uri);
  if (cached) {
    return cached.body;
  }

  return Buffer.from(await provider.readFile(uri)).toString("utf8");
}

function resolveMirrorTarget(
  target: KiwiPlansTreeNode | undefined
): Extract<KiwiPlansTreeNode, { kind: "case" }> | undefined {
  const resolved = target?.kind === "case" ? target : activeCaseNode();
  if (!resolved) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }
  return resolved;
}

function resolvePlanMirrorTarget(
  target: KiwiPlansTreeNode | undefined
): Extract<KiwiPlansTreeNode, { kind: "plan" }> | undefined {
  if (!target || target.kind !== "plan") {
    void vscode.window.showInformationMessage("Select a Kiwi plan first.");
    return undefined;
  }
  return target;
}

function createLocalMirrorService(
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>
): LocalMirrorService | undefined {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showInformationMessage(
      "Open a workspace folder before using local mirror commands."
    );
    return undefined;
  }

  return new LocalMirrorService(clientFactory, workspaceRoot);
}

function activeCaseNode(): Extract<KiwiPlansTreeNode, { kind: "case" }> | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  if (!uri || !isCaseDocumentUri(uri)) {
    return undefined;
  }

  const match = /^\/plans\/([^/]+)\/cases\/([^/]+)$/.exec(uri.path);
  if (!match) {
    return undefined;
  }

  const planId = parseNumericPrefix(match[1]);
  const caseId = parseNumericPrefix(match[2]);
  if (planId === undefined || caseId === undefined) {
    return undefined;
  }

  return {
    kind: "case",
    plan: { id: planId, name: parseSummaryFromSegment(match[1]) },
    caseRef: { id: caseId, summary: parseSummaryFromFile(match[2]) }
  };
}

function caseDiffUri(
  side: "local" | "remote" | "history" | "latest",
  plan: { id: number; name: string },
  caseRef: { id: number; summary: string },
  requestId: string
): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-diff:/${side}/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/cases/${encodeURIComponent(`${caseRef.id} - ${caseRef.summary}.md`)}?requestId=${encodeURIComponent(requestId)}`
  );
}

async function pickCaseHistoryId(history: Awaited<ReturnType<ReturnType<typeof createAdapter>["getCaseHistory"]>>): Promise<number | undefined> {
  const items = buildCaseHistoryQuickPickItems(history);
  if (items.length === 0) {
    void vscode.window.showInformationMessage("Selectable case history was not found.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "差分表示する履歴を選択してください",
    matchOnDescription: true,
    matchOnDetail: true
  });
  return picked?.history.historyId;
}

function planInfoUri(plan: { id: number; name: string }): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-plan-info:/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/plan.md`
  );
}

function planLocalMirrorStatusUri(plan: { id: number; name: string }): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-plan-local-mirror:/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/status.md`
  );
}

function localMirrorDiffUri(
  side: "local" | "remote",
  plan: { id: number; name: string },
  caseRef: { id: number; summary: string },
  requestId: string
): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-diff:/mirror-${side}/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/cases/${encodeURIComponent(`${caseRef.id} - ${caseRef.summary}.md`)}?requestId=${encodeURIComponent(requestId)}`
  );
}

function caseAttachmentsUri(
  plan: { id: number; name: string },
  caseRef: { id: number; summary: string }
): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-attachments:/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/cases/${encodeURIComponent(`${caseRef.id} - ${caseRef.summary}.md`)}`
  );
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

function parseSummaryFromSegment(value: string): string {
  return value.replace(/^\d+\s*-\s*/, "").trim();
}

function parseSummaryFromFile(value: string): string {
  return value.replace(/^\d+\s*-\s*/, "").replace(/\.md$/i, "").trim();
}

function humanMessage(error: unknown): string {
  if (error instanceof KiwiError) {
    switch (error.code) {
      case "AuthenticationFailed":
        return "Kiwi authentication failed. Run 'Kiwi: Configure Base URL', 'Kiwi: Configure Username', and 'Kiwi: Configure Password'.";
      case "AuthorizationFailed":
        return "Kiwi authorization failed. Your account cannot access this data.";
      case "ConnectionFailed":
        return "Kiwi connection failed. Verify the base URL and server status.";
      case "ValidationFailed":
        return error.message;
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function pickAttachmentForBrowser(
  items: AttachmentQuickPickItem[],
  placeHolder: string
): Promise<AttachmentQuickPickItem | undefined> {
  return vscode.window.showQuickPick(items, {
    placeHolder,
    matchOnDescription: true,
    matchOnDetail: true
  });
}

async function pickCaseSearchItem(
  items: CaseSearchQuickPickItem[]
): Promise<CaseSearchQuickPickItem | undefined> {
  return vscode.window.showQuickPick(items, {
    placeHolder: "開くテストケースを選択してください",
    matchOnDescription: true,
    matchOnDetail: true
  });
}

async function pickExistingCaseToPlanItem(
  items: ExistingCaseToPlanQuickPickItem[]
): Promise<ExistingCaseToPlanQuickPickItem | undefined> {
  return vscode.window.showQuickPick(items, {
    placeHolder: "この計画に追加する既存テストケースを選択してください",
    matchOnDescription: true,
    matchOnDetail: true
  });
}

async function pickRemoveCaseFromPlanItem(
  items: RemoveCaseFromPlanQuickPickItem[]
): Promise<RemoveCaseFromPlanQuickPickItem | undefined> {
  return vscode.window.showQuickPick(items, {
    placeHolder: "この計画から外すテストケースを選択してください",
    matchOnDescription: true,
    matchOnDetail: true
  });
}

async function pickExecutionItem(
  items: ExecutionQuickPickItem[]
): Promise<ExecutionQuickPickItem | undefined> {
  return vscode.window.showQuickPick(items, {
    placeHolder: "実行結果を記録する Test Run を選択してください",
    matchOnDescription: true,
    matchOnDetail: true
  });
}

function serializeExistingCaseToPlanItem(item: ExistingCaseToPlanQuickPickItem): {
  label: string;
  description: string;
  detail: string;
  caseId: number;
  summary: string;
  plans: Array<{ id: number; name: string }>;
} {
  return {
    label: item.label,
    description: item.description,
    detail: item.detail,
    caseId: item.entry.caseId,
    summary: item.entry.summary,
    plans: item.entry.plans.map((plan) => ({ id: plan.id, name: plan.name }))
  };
}

function serializeRemoveCaseFromPlanItem(item: RemoveCaseFromPlanQuickPickItem): {
  label: string;
  description: string;
  detail: string;
  planId: number;
  caseId: number;
  summary: string;
} {
  return {
    label: item.label,
    description: item.description,
    detail: item.detail,
    planId: item.plan.id,
    caseId: item.caseRef.id,
    summary: item.caseRef.summary
  };
}

function serializeExecutionItem(item: ExecutionQuickPickItem): {
  label: string;
  description: string | undefined;
  detail: string | undefined;
  executionId: number;
  runId: number;
  caseId: number;
  status: string;
} {
  return {
    label: item.label,
    description: item.description,
    detail: item.detail,
    executionId: item.execution.id,
    runId: item.execution.runId,
    caseId: item.execution.caseId,
    status: item.execution.status
  };
}

function logInBackground(
  logger: JsonlLogger,
  event: Parameters<JsonlLogger["log"]>[0]
): void {
  void logger.log(event).catch(() => undefined);
}

function isCaseDocumentUri(uri: vscode.Uri): boolean {
  return uri.scheme === "kiwi" && /^\/plans\/[^/]+\/cases\/.+\.md$/.test(uri.path);
}

function parseCaseDocumentIdentity(
  uri: vscode.Uri
): { planId: number; caseId: number; summary: string } | undefined {
  if (!isCaseDocumentUri(uri)) {
    return undefined;
  }

  const match = /^\/plans\/([^/]+)\/cases\/([^/]+)$/.exec(uri.path);
  if (!match) {
    return undefined;
  }

  const planId = parseNumericPrefix(match[1]);
  const caseId = parseNumericPrefix(match[2]);
  if (planId === undefined || caseId === undefined) {
    return undefined;
  }

  return {
    planId,
    caseId,
    summary: parseSummaryFromFile(match[2])
  };
}

async function handleCaseMetadataEditorSaved(args: {
  caseProvider: KiwiFileSystemProvider;
  treeDataProvider: KiwiPlansTreeDataProvider;
  result: MetadataEditorSaveResult;
}): Promise<void> {
  const { caseProvider, treeDataProvider, result } = args;
  if (result.kind === "created") {
    caseProvider.refreshListings();
    treeDataProvider.refresh();
    await openCreatedCaseDocument(result);
    void vscode.window.showInformationMessage(
      result.mode === "duplicate" ? "Case duplicated." : "Case created."
    );
    return;
  }

  let message = "Metadata saved.";

  if (result.changedFields.includes("summary")) {
    caseProvider.refreshListings();
    treeDataProvider.refresh();
    const reopenOutcome = await reopenOpenedCaseDocumentsAfterSummaryChange(result);
    if (reopenOutcome === "reopened") {
      message = "Metadata saved. Opened case document was reopened with the updated summary.";
    } else if (reopenOutcome === "dirty") {
      message =
        "Metadata saved. Opened case document was not reopened because it has unsaved changes.";
    }
  }

  void vscode.window.showInformationMessage(message);
}

async function handleExecutionResultSaved(result: ExecutionResultSaveResult): Promise<void> {
  void vscode.window.showInformationMessage(
    result.changedFields.length === 0
      ? "実行結果に変更はありません。"
      : "実行結果を保存しました。"
  );
}

async function reopenOpenedCaseDocumentsAfterSummaryChange(
  result: Extract<MetadataEditorSaveResult, { kind: "updated" }>
): Promise<"reopened" | "dirty" | "not-open"> {
  const matchingDocuments = vscode.workspace.textDocuments.filter((document) => {
    const identity = parseCaseDocumentIdentity(document.uri);
    return identity?.planId === result.planId && identity.caseId === result.caseId;
  });
  if (matchingDocuments.length === 0) {
    return "not-open";
  }
  if (matchingDocuments.some((document) => document.isDirty)) {
    return "dirty";
  }

  const oldUris = [...new Set(matchingDocuments.map((document) => document.uri.toString()))];
  const newUri = vscode.Uri.parse(
    `kiwi:/plans/${planDirectoryName({ id: result.planId, name: result.planName })}/cases/${caseFileName({
      id: result.caseId,
      summary: result.updatedCase.summary
    })}`
  );
  const reopenedDocument = await vscode.workspace.openTextDocument(newUri);

  for (const group of vscode.window.tabGroups.all) {
    const groupHasOldTab = group.tabs.some((tab) => {
      const tabUri = getTabUriString(tab);
      return tabUri ? oldUris.includes(tabUri) : false;
    });
    if (!groupHasOldTab) {
      continue;
    }
    await vscode.window.showTextDocument(reopenedDocument, {
      viewColumn: group.viewColumn,
      preview: false,
      preserveFocus: true
    });
  }

  const tabTargets = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter((tab) => {
      const tabUri = getTabUriString(tab);
      return tabUri ? oldUris.includes(tabUri) : false;
    })
  );
  if (tabTargets.length > 0) {
    await vscode.window.tabGroups.close(tabTargets, true);
  }

  return "reopened";
}

async function openCreatedCaseDocument(
  result: Extract<MetadataEditorSaveResult, { kind: "created" }>
): Promise<void> {
  const uri = vscode.Uri.parse(
    `kiwi:/plans/${planDirectoryName({ id: result.planId, name: result.planName })}/cases/${caseFileName({
      id: result.createdCase.id,
      summary: result.createdCase.summary
    })}`
  );
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    preview: false
  });
}

function getTabUriString(tab: vscode.Tab): string | undefined {
  if (tab.input instanceof vscode.TabInputText) {
    return tab.input.uri.toString();
  }
  return undefined;
}

async function refreshOpenedCaseDocumentAfterLocalMirrorUpload(
  provider: KiwiFileSystemProvider,
  target: Extract<KiwiPlansTreeNode, { kind: "case" }>
): Promise<"refreshed" | "dirty" | "not-open"> {
  const uri = vscode.Uri.parse(
    `kiwi:/plans/${planDirectoryName(target.plan)}/cases/${caseFileName(target.caseRef)}`
  );
  const openedDocument = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString()
  );
  if (!openedDocument) {
    return "not-open";
  }
  if (openedDocument.isDirty) {
    return "dirty";
  }

  const previousEditor = vscode.window.activeTextEditor;
  const targetEditor =
    vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === uri.toString()) ??
    (await vscode.window.showTextDocument(openedDocument, {
      preview: false,
      preserveFocus: false
    }));

  await vscode.window.showTextDocument(targetEditor.document, {
    preview: false,
    preserveFocus: false,
    viewColumn: targetEditor.viewColumn
  });
  await provider.refreshCaseDocument(uri);
  await vscode.commands.executeCommand("workbench.action.files.revert");

  if (
    previousEditor &&
    previousEditor.document.uri.toString() !== uri.toString()
  ) {
    await vscode.window.showTextDocument(previousEditor.document, {
      preview: false,
      preserveFocus: false,
      viewColumn: previousEditor.viewColumn
    });
  }

  return "refreshed";
}
