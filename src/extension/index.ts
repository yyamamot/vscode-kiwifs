import * as vscode from "vscode";
import {
  resolveKiwiConfig,
} from "../config/resolveConfig";
import { createAdapter } from "../adapter/createAdapter";
import { KiwiFileSystemProvider } from "../provider/KiwiFileSystemProvider";
import { JsonlLogger } from "../logging/jsonlLogger";
import {
  caseDocumentUri,
  KiwiPlansTreeDataProvider,
  KiwiPlansTreeNode
} from "./KiwiPlansTreeDataProvider";
import {
  createKiwiLocalMirrorSourceControl,
  type LocalMirrorScmState
} from "./localMirrorSourceControl";
import {
  CaseMetadataEditorController
} from "./caseMetadataEditorController";
import { CaseFilterController } from "./caseFilterController";
import {
  ExecutionResultController
} from "./executionResultController";
import { CaseExecutionBoardController } from "./caseExecutionBoardController";
import { TestRunDashboardController } from "./testRunDashboardController";
import { TestRunFilterController } from "./testRunFilterController";
import { CaseFreshnessService } from "./caseFreshnessService";
import {
  recordAutoCaseFreshnessCheck,
  shouldSkipAutoCaseFreshnessCheck
} from "./autoCaseFreshnessTracker";
import {
  CaseAttachmentContentProvider,
  CaseAttachmentsDocumentProvider,
  CaseDiffDocumentProvider,
  CaseHistoryDocumentProvider,
  CaseInfoDocumentProvider,
  PlanInfoDocumentProvider,
} from "./documentProviders";
import {
  AttachmentUploadService,
  KiwiPlansDragAndDropController
} from "./attachmentServices";
import {
  isCaseDocumentUri
} from "./extensionUris";
import {
  handleCaseMetadataEditorSaved,
  handleExecutionResultSaved
} from "./caseDocumentLifecycle";
import {
  resolveCaseBrowserTarget,
  resolvePlanBrowserTarget
} from "./commandTargetResolvers";
import { registerCasePlanMembershipCommands } from "./casePlanMembershipCommands";
import { registerUiReviewTestCommands } from "./testSupport/uiReviewTestCommands";
import { registerDomainTestCommands } from "./testSupport/domainTestCommands";
import { registerIntegrationTestCommands } from "./testSupport/integrationTestCommands";
import { registerConfigRuntimeCommands } from "./configRuntimeCommands";
import {
  checkCaseFreshness,
  registerCaseDocumentCommands
} from "./caseDocumentCommands";
import { registerExecutionCommands } from "./executionCommands";
import { registerAttachmentCommands } from "./attachmentCommands";
import { registerCaseMetadataCommands } from "./caseMetadataCommands";
import { registerPlanNavigationCommands } from "./planNavigationCommands";
import { registerCaseSearchCommands } from "./caseSearchCommands";
import { registerCaseDeletionCommands } from "./caseDeletionCommands";
import { registerLocalMirrorCommands } from "./localMirrorCommands";
import { registerLlmSkillPackCommands } from "./llmSkillPackCommands";
import { localize } from "./l10n";
import { createVscodeLocalMirrorLocalChangeMonitor } from "./localMirrorLocalChangeMonitor";
import { createLocalMirrorRemoteMetadataChecker } from "./localMirrorRemoteMetadataCheck";
import { readLocalMirrorManifest } from "./localMirrorService";
import { TreeItemActionSurfaceController } from "./treeItemActionSurfaceController";
import { registerTreeItemActionSurfaceCommands } from "./treeItemActionSurfaceCommands";

let providerRegistration: vscode.Disposable | undefined;
const RUNTIME_LOGS_ENABLED_CONTEXT = "kiwi.runtimeLogsEnabled";

function isDebugF5Runtime(): boolean {
  return process.env.KIWI_RUNTIME_MODE === "debug-f5";
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await vscode.commands.executeCommand("setContext", RUNTIME_LOGS_ENABLED_CONTEXT, isDebugF5Runtime());
  const logger = new JsonlLogger({ forbiddenRootFsPath: context.extensionPath });
  const adapterCache = new Map<string, ReturnType<typeof createAdapter>>();
  const clientFactory = async () => {
    const config = await resolveKiwiConfig(context);
    const key = config.baseUrl;
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
  const treeDataProvider = new KiwiPlansTreeDataProvider(clientFactory, logger);
  const provider = new KiwiFileSystemProvider(clientFactory, logger, ({ caseId }) => {
    treeDataProvider.markCaseStale(
      caseId,
      localize("Remote content has changed. Check the diff or refresh explicitly.")
    );
  });
  const caseFreshnessService = new CaseFreshnessService(clientFactory, provider);
  const autoCaseFreshnessState = {
    lastCheckedUri: undefined as string | undefined,
    lastCheckedVersionToken: undefined as string | undefined
  };
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
  const testRunFilterController = new TestRunFilterController(clientFactory, async (runId) => {
    await testRunDashboardController.openRun(runId);
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
  context.subscriptions.push(testRunFilterController);
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (isCaseDocumentUri(document.uri)) {
        provider.releaseCaseDocument(document.uri);
      }
    })
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || !isCaseDocumentUri(editor.document.uri)) {
        autoCaseFreshnessState.lastCheckedUri = undefined;
        autoCaseFreshnessState.lastCheckedVersionToken = undefined;
        return;
      }

      const session = provider.getCaseDocumentSession(editor.document.uri);
      if (
        shouldSkipAutoCaseFreshnessCheck(
          autoCaseFreshnessState,
          editor.document.uri,
          session?.versionToken
        )
      ) {
        return;
      }
      recordAutoCaseFreshnessCheck(
        autoCaseFreshnessState,
        editor.document.uri,
        session?.versionToken
      );
      void checkCaseFreshness({
        provider,
        treeDataProvider,
        service: caseFreshnessService,
        showActions: false
      });
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
  const caseHistoryProvider = new CaseHistoryDocumentProvider();
  const planInfoProvider = new PlanInfoDocumentProvider();
  const caseAttachmentsProvider = new CaseAttachmentsDocumentProvider();
  const caseAttachmentContentProvider = new CaseAttachmentContentProvider();
  const localMirrorSourceControl = createKiwiLocalMirrorSourceControl();
  const treeItemActionSurfaceController = new TreeItemActionSurfaceController({
    async loadCaseMetadata(target) {
      const { adapter, config } = await clientFactory();
      const caseData = await adapter.getCase(config, target.caseRef.id, target.plan.id);
      return {
        status: caseData.status,
        priority: caseData.priority,
        category: caseData.category,
        tags: caseData.tags
      };
    },
    async loadPlanSummary(target) {
      const { adapter, config } = await clientFactory();
      const [caseRefs, testRuns] = await Promise.all([
        adapter.listPlanCases(config, target.plan.id),
        adapter.searchTestRuns(config, { query: "", planId: target.plan.id })
      ]);
      return {
        caseCount: caseRefs.length,
        testRunCount: testRuns.length,
        localMirrorSummary: summarizePlanLocalMirrorState(
          localMirrorSourceControl.getState(),
          target.plan.id
        )
      };
    }
  });
  context.subscriptions.push(treeItemActionSurfaceController);
  context.subscriptions.push(localMirrorSourceControl.sourceControl as unknown as vscode.Disposable);
  const setLocalMirrorTreeSnapshot = (state: { resources: ReadonlyArray<{ caseRef: { id: number }; status: "LocalChanged" | "RemoteChanged" | "Conflict" }> }) => {
    treeDataProvider.setCompareSnapshot(
      state.resources.map((resource) => ({
        caseId: resource.caseRef.id,
        status: resource.status
      }))
    );
  };
  const localMirrorRemoteMetadataChecker = createLocalMirrorRemoteMetadataChecker({
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    clientFactory,
    async readLocalFile(localPath) {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(localPath));
      return new TextDecoder().decode(bytes);
    },
    readManifest: readLocalMirrorManifest,
    getLocalMirrorScmState: () => localMirrorSourceControl.getState(),
    setLocalMirrorScmState: (state) => localMirrorSourceControl.setState(state),
    clearLocalMirrorScmState: () => localMirrorSourceControl.clear(),
    setTreeCompareSnapshot: setLocalMirrorTreeSnapshot,
    clearTreeCompareSnapshot: () => treeDataProvider.clearCompareSnapshot(),
    now: () => Date.now()
  });
  context.subscriptions.push(
    createVscodeLocalMirrorLocalChangeMonitor({
      getLocalMirrorScmState: () => localMirrorSourceControl.getState(),
      setLocalMirrorScmState: (state) => localMirrorSourceControl.setState(state),
      clearLocalMirrorScmState: () => localMirrorSourceControl.clear(),
      setTreeCompareSnapshot: setLocalMirrorTreeSnapshot,
      clearTreeCompareSnapshot: () => treeDataProvider.clearCompareSnapshot(),
      onLocalOnlyRefresh: () => {
        void localMirrorRemoteMetadataChecker.checkCurrentLocalChangedResources();
      }
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void localMirrorRemoteMetadataChecker.checkCurrentLocalChangedResources();
      }
    })
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("kiwi-info", caseInfoProvider)
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("kiwi-diff", caseDiffProvider)
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("kiwi-history", caseHistoryProvider)
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("kiwi-plan-info", planInfoProvider)
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
    ...registerConfigRuntimeCommands({
      context,
      provider,
      treeDataProvider,
      logger,
      isDebugF5Runtime
    }),
    ...registerCaseSearchCommands({
      clientFactory,
      caseFilterController
    }),
    ...registerCaseDocumentCommands({
      provider,
      treeDataProvider,
      clientFactory,
      caseFreshnessService,
      caseDiffProvider,
      caseHistoryProvider,
      caseInfoProvider
    }),
    ...registerCaseMetadataCommands({
      metadataEditorController
    }),
    ...registerCasePlanMembershipCommands({
      clientFactory,
      provider,
      treeDataProvider
    }),
    ...registerCaseDeletionCommands({
      clientFactory,
      provider,
      treeDataProvider
    }),
    ...registerExecutionCommands({
      clientFactory,
      caseExecutionBoardController,
      executionResultController,
      testRunDashboardController,
      testRunFilterController
    }),
    ...registerAttachmentCommands({
      clientFactory,
      logger,
      caseAttachmentsProvider,
      caseAttachmentContentProvider,
      attachmentUploadService
    }),
    ...registerPlanNavigationCommands({
      clientFactory,
      planInfoProvider
    }),
    ...registerLocalMirrorCommands({
      context,
      clientFactory,
      provider,
      treeDataProvider,
      caseDiffProvider,
      localMirrorSourceControl,
      localMirrorRemoteMetadataChecker
    }),
    ...registerLlmSkillPackCommands({
      getLocalMirrorScmState: () => localMirrorSourceControl.getState()
    }),
    ...registerTreeItemActionSurfaceCommands({
      controller: treeItemActionSurfaceController
    }),
    ...registerUiReviewTestCommands({
      logger,
      caseFilterController,
      testRunFilterController,
      treeDataProvider,
      treeView,
      extensionPath: context.extensionPath
    }),
    ...registerDomainTestCommands({
      caseExecutionBoardController,
      executionResultController,
      testRunDashboardController,
      metadataEditorController
    }),
    ...registerIntegrationTestCommands({
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
    })
  );
}

export function deactivate(): void {
  providerRegistration?.dispose();
}

function summarizePlanLocalMirrorState(
  state: LocalMirrorScmState | undefined,
  planId: number
): string {
  if (!state) {
    return localize("Not Compared");
  }
  const resources = state.resources.filter((resource) => resource.plan.id === planId);
  if (resources.length === 0) {
    return localize("Not Compared");
  }

  const localChanged = resources.filter((resource) => resource.status === "LocalChanged").length;
  const remoteChanged = resources.filter((resource) => resource.status === "RemoteChanged").length;
  const conflicts = resources.filter((resource) => resource.status === "Conflict").length;
  return localize(
    "Local Changes {0} / Kiwi Changes {1} / Conflicts {2}",
    localChanged,
    remoteChanged,
    conflicts
  );
}
