import * as vscode from "vscode";
import { KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";
import {
  toTreeItemActionSurfaceState,
  TreeItemActionSurfaceCaseMetadata,
  type TreeItemActionSurfaceLabels,
  TreeItemActionSurfacePlanSummary,
  TreeItemActionSurfaceState,
  TreeItemActionSurfaceTarget
} from "./treeItemActionSurfaceModel";
import { localize } from "./l10n";
import { renderTreeItemActionSurfaceWebviewHtml } from "./webview/treeItemActionSurfaceView";

type PanelSession = {
  key: string;
  targetNode: Extract<KiwiPlansTreeNode, { kind: "plan" | "case" }>;
  state: TreeItemActionSurfaceState;
  panel: vscode.WebviewPanel;
};

export class TreeItemActionSurfaceController implements vscode.Disposable {
  private readonly sessions = new Map<string, PanelSession>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly loaders: {
    loadCaseMetadata?: (
      target: Extract<KiwiPlansTreeNode, { kind: "case" }>
    ) => Promise<TreeItemActionSurfaceCaseMetadata | undefined>;
    loadPlanSummary?: (
      target: Extract<KiwiPlansTreeNode, { kind: "plan" }>
    ) => Promise<TreeItemActionSurfacePlanSummary | undefined>;
  } = {}) {}

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    for (const session of this.sessions.values()) {
      session.panel.dispose();
    }
    this.sessions.clear();
  }

  async open(targetNode: KiwiPlansTreeNode | undefined): Promise<vscode.WebviewPanel | undefined> {
    if (!targetNode || (targetNode.kind !== "plan" && targetNode.kind !== "case")) {
      void vscode.window.showInformationMessage(localize("Select an item in Kiwi Plans."));
      return undefined;
    }

    const target = toSurfaceTarget(targetNode);
    const key = sessionKey(target);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.state = await this.createState(targetNode, target);
      existing.panel.webview.html = renderTreeItemActionSurfaceWebviewHtml(existing.panel.webview, existing.state);
      existing.panel.reveal(vscode.ViewColumn.Active);
      return existing.panel;
    }
    const state = await this.createState(targetNode, target);

    const panel = vscode.window.createWebviewPanel(
      "kiwiTreeItemActions",
      state.title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true
      }
    );
    const session: PanelSession = {
      key,
      targetNode,
      state,
      panel
    };
    this.sessions.set(key, session);
    panel.webview.html = renderTreeItemActionSurfaceWebviewHtml(panel.webview, state);

    this.disposables.push(
      panel.webview.onDidReceiveMessage(async (message) => {
        if (!message || typeof message !== "object" || message.type !== "run") {
          return;
        }
        const actionId = typeof message.actionId === "string" ? message.actionId : "";
        await this.runAction(session, actionId);
      }),
      panel.onDidDispose(() => {
        this.sessions.delete(key);
      })
    );

    return panel;
  }

  async getState(targetNode: KiwiPlansTreeNode | undefined): Promise<TreeItemActionSurfaceState | undefined> {
    if (!targetNode || (targetNode.kind !== "plan" && targetNode.kind !== "case")) {
      return undefined;
    }
    return this.createState(targetNode, toSurfaceTarget(targetNode));
  }

  private async runAction(session: PanelSession, actionId: string): Promise<void> {
    const action = session.state.items.find((item) => item.id === actionId);
    if (!action) {
      return;
    }
    await vscode.commands.executeCommand(action.command, session.targetNode);
  }

  private async createState(
    targetNode: Extract<KiwiPlansTreeNode, { kind: "plan" | "case" }>,
    target: TreeItemActionSurfaceTarget
  ): Promise<TreeItemActionSurfaceState> {
    const labels = localizedSurfaceLabels();
    if (targetNode.kind === "plan") {
      try {
        return toTreeItemActionSurfaceState(target, undefined, await this.loaders.loadPlanSummary?.(targetNode), labels);
      } catch {
        return toTreeItemActionSurfaceState(target, undefined, undefined, labels);
      }
    }
    if (!this.loaders.loadCaseMetadata) {
      return toTreeItemActionSurfaceState(target, undefined, undefined, labels);
    }
    try {
      return toTreeItemActionSurfaceState(target, await this.loaders.loadCaseMetadata(targetNode), undefined, labels);
    } catch {
      return toTreeItemActionSurfaceState(target, undefined, undefined, labels);
    }
  }
}

function localizedSurfaceLabels(): TreeItemActionSurfaceLabels {
  return {
    planTitle: localize("Test Plan Actions"),
    planInfo: localize("Test Plan Information"),
    planId: localize("Test Plan ID"),
    name: localize("Name"),
    description: localize("Description"),
    caseCount: localize("Child Test Cases"),
    testRunCount: localize("Test Runs"),
    localMirror: localize("Local Mirror"),
    notCompared: localize("Not Compared"),
    openBrowser: localize("Open in Browser"),
    openPlanBrowserDescription: localize("Open this Kiwi test plan in the browser."),
    createHere: localize("Create Here"),
    createHereDescription: localize("Create a new test case in this test plan."),
    addExistingCase: localize("Add Existing Test Case"),
    addExistingCaseDescription: localize("Add an existing test case to this test plan."),
    findTestCases: localize("Find Test Cases"),
    findTestCasesDescription: localize("Find test cases by conditions and open the target test case."),
    openTestRunDashboard: localize("Open Test Run Dashboard"),
    openTestRunDashboardDescription: localize("Create, view, and update test runs."),
    findTestRuns: localize("Find Test Runs"),
    findTestRunsDescription: localize("Find test runs by conditions and open the target dashboard."),
    syncChildCases: localize("Sync Child Test Cases Locally"),
    syncChildCasesDescription: localize("Sync test case bodies under this test plan to the local mirror."),
    checkChildCaseDiffs: localize("Check Child Test Case Diffs"),
    checkChildCaseDiffsDescription: localize("Check diffs and reflect them in Source Control View."),
    removeCaseFromPlan: localize("Remove Test Case from Test Plan"),
    removeCaseFromPlanDescription: localize("Select and remove an existing test case from this test plan."),
    caseTitle: localize("Test Case Actions"),
    caseInfo: localize("Test Case Information"),
    caseId: localize("Test Case ID"),
    overview: localize("Overview"),
    testPlan: localize("Test Plan"),
    status: localize("Status"),
    priority: localize("Priority"),
    category: localize("Category"),
    tags: localize("Tags"),
    showHistoryDiff: localize("Show History Diff"),
    showHistoryDiffDescription: localize("Review diffs between histories or between history and latest."),
    showHistoryList: localize("Show History List"),
    showHistoryListDescription: localize("Review history metadata in a read-only document."),
    editBasicInfo: localize("Edit Basic Information"),
    editBasicInfoDescription: localize("Edit overview / status / priority / tags. Edit the body in the test case body document."),
    duplicate: localize("Duplicate"),
    duplicateDescription: localize("Create a new test case from the target test case metadata and body."),
    showAttachmentEditor: localize("Show Attachment in Editor"),
    showAttachmentEditorDescription: localize("Open a supported attachment in the VS Code editor."),
    showAttachmentBrowser: localize("Show Attachment in Browser"),
    showAttachmentBrowserDescription: localize("Open a browser-compatible attachment in the default browser."),
    addAttachment: localize("Add Attachment"),
    addAttachmentDescription: localize("Add a local file as an attachment."),
    updateExecutionResult: localize("Update Test Execution Result"),
    updateExecutionResultDescription: localize("Update the test execution result for the target test case."),
    manageExecution: localize("Manage Test Executions"),
    manageExecutionDescription: localize("Manage registered test runs and execution results together."),
    openLocalMirror: localize("Open Local Mirror"),
    openLocalMirrorDescription: localize("Open the local mirror file for reference. Compare and apply changes in Source Control View.")
  };
}

function toSurfaceTarget(
  node: Extract<KiwiPlansTreeNode, { kind: "plan" | "case" }>
): TreeItemActionSurfaceTarget {
  if (node.kind === "plan") {
    return {
      kind: "plan",
      planId: node.plan.id,
      planName: node.plan.name,
      planText: node.plan.text
    };
  }
  return {
    kind: "case",
    planId: node.plan.id,
    planName: node.plan.name,
    caseId: node.caseRef.id,
    caseSummary: node.caseRef.summary
  };
}

function sessionKey(target: TreeItemActionSurfaceTarget): string {
  return target.kind === "plan"
    ? `plan:${target.planId}`
    : `case:${target.planId}:${target.caseId}`;
}
