export type TreeItemActionSurfaceTarget =
  | {
      kind: "plan";
      planId: number;
      planName: string;
      planText?: string;
    }
  | {
      kind: "case";
      planId: number;
      planName: string;
      caseId: number;
      caseSummary: string;
    };

export type TreeItemActionSurfaceCaseMetadata = {
  status: string;
  priority: string;
  category: string;
  tags: string[];
};

export type TreeItemActionSurfacePlanSummary = {
  caseCount?: number;
  testRunCount?: number;
  localMirrorSummary?: string;
};

export type TreeItemActionSurfaceItem = {
  id: string;
  category: "inspect" | "cases" | "edit" | "create" | "attachments" | "execution" | "mirror" | "danger";
  label: string;
  description: string;
  command: string;
  mode?: "normal" | "danger";
};

export type TreeItemActionSurfaceState = {
  target: TreeItemActionSurfaceTarget;
  title: string;
  subtitle: string;
  overview?: {
    title: string;
    rows: Array<{ label: string; value: string }>;
  };
  items: TreeItemActionSurfaceItem[];
};

export type TreeItemActionSurfaceLabels = Record<
  | "planTitle" | "planInfo" | "planId" | "name" | "description" | "caseCount" | "testRunCount" | "localMirror" | "notCompared"
  | "openBrowser" | "openPlanBrowserDescription" | "createHere" | "createHereDescription" | "addExistingCase" | "addExistingCaseDescription"
  | "findTestCases" | "findTestCasesDescription" | "openTestRunDashboard" | "openTestRunDashboardDescription"
  | "findTestRuns" | "findTestRunsDescription" | "syncChildCases" | "syncChildCasesDescription"
  | "checkChildCaseDiffs" | "checkChildCaseDiffsDescription" | "removeCaseFromPlan" | "removeCaseFromPlanDescription"
  | "caseTitle" | "caseInfo" | "caseId" | "overview" | "testPlan" | "status" | "priority" | "category" | "tags"
  | "showHistoryDiff" | "showHistoryDiffDescription" | "showHistoryList" | "showHistoryListDescription"
  | "editBasicInfo" | "editBasicInfoDescription" | "duplicate" | "duplicateDescription"
  | "showAttachmentEditor" | "showAttachmentEditorDescription" | "showAttachmentBrowser" | "showAttachmentBrowserDescription"
  | "addAttachment" | "addAttachmentDescription" | "updateExecutionResult" | "updateExecutionResultDescription"
  | "manageExecution" | "manageExecutionDescription" | "openLocalMirror" | "openLocalMirrorDescription",
  string
>;

export const DEFAULT_TREE_ITEM_ACTION_SURFACE_LABELS: TreeItemActionSurfaceLabels = {
  planTitle: "Test Plan Actions",
  planInfo: "Test Plan Information",
  planId: "Test Plan ID",
  name: "Name",
  description: "Description",
  caseCount: "Child Test Cases",
  testRunCount: "Test Runs",
  localMirror: "Local Mirror",
  notCompared: "Not Compared",
  openBrowser: "Open in Browser",
  openPlanBrowserDescription: "Open this Kiwi test plan in the browser.",
  createHere: "Create Here",
  createHereDescription: "Create a new test case in this test plan.",
  addExistingCase: "Add Existing Test Case",
  addExistingCaseDescription: "Add an existing test case to this test plan.",
  findTestCases: "Find Test Cases",
  findTestCasesDescription: "Find test cases by conditions and open the target test case.",
  openTestRunDashboard: "Open Test Run Dashboard",
  openTestRunDashboardDescription: "Create, view, and update test runs.",
  findTestRuns: "Find Test Runs",
  findTestRunsDescription: "Find test runs by conditions and open the target dashboard.",
  syncChildCases: "Sync Child Test Cases Locally",
  syncChildCasesDescription: "Sync test case bodies under this test plan to the local mirror.",
  checkChildCaseDiffs: "Check Child Test Case Diffs",
  checkChildCaseDiffsDescription: "Check diffs and reflect them in Source Control View.",
  removeCaseFromPlan: "Remove Test Case from Test Plan",
  removeCaseFromPlanDescription: "Select and remove an existing test case from this test plan.",
  caseTitle: "Test Case Actions",
  caseInfo: "Test Case Information",
  caseId: "Test Case ID",
  overview: "Overview",
  testPlan: "Test Plan",
  status: "Status",
  priority: "Priority",
  category: "Category",
  tags: "Tags",
  showHistoryDiff: "Show History Diff",
  showHistoryDiffDescription: "Review diffs between histories or between history and latest.",
  showHistoryList: "Show History List",
  showHistoryListDescription: "Review history metadata in a read-only document.",
  editBasicInfo: "Edit Basic Information",
  editBasicInfoDescription: "Edit overview / status / priority / tags. Edit the body in the test case body document.",
  duplicate: "Duplicate",
  duplicateDescription: "Create a new test case from the target test case metadata and body.",
  showAttachmentEditor: "Show Attachment in Editor",
  showAttachmentEditorDescription: "Open a supported attachment in the VS Code editor.",
  showAttachmentBrowser: "Show Attachment in Browser",
  showAttachmentBrowserDescription: "Open a browser-compatible attachment in the default browser.",
  addAttachment: "Add Attachment",
  addAttachmentDescription: "Add a local file as an attachment.",
  updateExecutionResult: "Update Test Execution Result",
  updateExecutionResultDescription: "Update the test execution result for the target test case.",
  manageExecution: "Manage Test Executions",
  manageExecutionDescription: "Manage registered test runs and execution results together.",
  openLocalMirror: "Open Local Mirror",
  openLocalMirrorDescription: "Open the local mirror file for reference. Compare and apply changes in Source Control View."
};

export function toTreeItemActionSurfaceState(
  target: TreeItemActionSurfaceTarget,
  metadata?: TreeItemActionSurfaceCaseMetadata,
  planSummary?: TreeItemActionSurfacePlanSummary,
  labels: TreeItemActionSurfaceLabels = DEFAULT_TREE_ITEM_ACTION_SURFACE_LABELS
): TreeItemActionSurfaceState {
  if (target.kind === "plan") {
    return {
      target,
      title: labels.planTitle,
      subtitle: `${target.planId} - ${target.planName}`,
      overview: {
        title: labels.planInfo,
        rows: [
          { label: labels.planId, value: String(target.planId) },
          { label: labels.name, value: target.planName },
          { label: labels.description, value: target.planText?.trim() || "-" },
          { label: labels.caseCount, value: formatOptionalCount(planSummary?.caseCount) },
          { label: labels.testRunCount, value: formatOptionalCount(planSummary?.testRunCount) },
          { label: labels.localMirror, value: planSummary?.localMirrorSummary ?? labels.notCompared }
        ]
      },
      items: [
        item("plan-open-browser", "inspect", labels.openBrowser, labels.openPlanBrowserDescription, "kiwi.openPlanInBrowser"),
        item("plan-create-case", "cases", labels.createHere, labels.createHereDescription, "kiwi.createCase"),
        item("plan-add-existing-case", "cases", labels.addExistingCase, labels.addExistingCaseDescription, "kiwi.addExistingCaseToPlan"),
        item("plan-filter-cases", "cases", labels.findTestCases, labels.findTestCasesDescription, "kiwi.filterCases"),
        item("plan-open-test-runs", "execution", labels.openTestRunDashboard, labels.openTestRunDashboardDescription, "kiwi.openTestRunDashboard"),
        item("plan-filter-test-runs", "execution", labels.findTestRuns, labels.findTestRunsDescription, "kiwi.filterTestRuns"),
        item("plan-download-mirror", "mirror", labels.syncChildCases, labels.syncChildCasesDescription, "kiwi.downloadPlanToLocalMirror"),
        item("plan-reflect-via-scm", "mirror", labels.checkChildCaseDiffs, labels.checkChildCaseDiffsDescription, "kiwi.comparePlanLocalMirror"),
        item("plan-remove-case", "danger", labels.removeCaseFromPlan, labels.removeCaseFromPlanDescription, "kiwi.removeCaseFromPlanFromPlan", "danger")
      ]
    };
  }

  return {
    target,
    title: labels.caseTitle,
    subtitle: `${target.caseId} - ${target.caseSummary}`,
    overview: {
      title: labels.caseInfo,
      rows: [
        { label: labels.caseId, value: String(target.caseId) },
        { label: labels.overview, value: target.caseSummary },
        { label: labels.testPlan, value: `${target.planId} - ${target.planName}` },
        ...(metadata ? [
          { label: labels.status, value: metadata.status || "-" },
          { label: labels.priority, value: metadata.priority || "-" },
          { label: labels.category, value: metadata.category || "-" },
          { label: labels.tags, value: metadata.tags.length > 0 ? metadata.tags.join(", ") : "-" }
        ] : [])
      ]
    },
    items: [
      item("case-history-diff", "inspect", labels.showHistoryDiff, labels.showHistoryDiffDescription, "kiwi.showCaseHistoryDiff"),
      item("case-history-list", "inspect", labels.showHistoryList, labels.showHistoryListDescription, "kiwi.showCaseHistory"),
      item("case-edit-metadata", "edit", labels.editBasicInfo, labels.editBasicInfoDescription, "kiwi.editCaseMetadata"),
      item("case-duplicate", "create", labels.duplicate, labels.duplicateDescription, "kiwi.duplicateCase"),
      item("case-attachment-editor", "attachments", labels.showAttachmentEditor, labels.showAttachmentEditorDescription, "kiwi.openCaseAttachmentInEditor"),
      item("case-attachment-browser", "attachments", labels.showAttachmentBrowser, labels.showAttachmentBrowserDescription, "kiwi.openCaseAttachmentInBrowser"),
      item("case-attachment-add", "attachments", labels.addAttachment, labels.addAttachmentDescription, "kiwi.addCaseAttachment"),
      item("case-execution-result", "execution", labels.updateExecutionResult, labels.updateExecutionResultDescription, "kiwi.recordCaseExecutionResult"),
      item("case-execution-board", "execution", labels.manageExecution, labels.manageExecutionDescription, "kiwi.manageCaseExecutionsAcrossRuns"),
      item("case-mirror-open", "mirror", labels.openLocalMirror, labels.openLocalMirrorDescription, "kiwi.revealLocalMirror")
    ]
  };
}

function formatOptionalCount(value: number | undefined): string {
  return value === undefined ? "-" : String(value);
}

function item(
  id: string,
  category: TreeItemActionSurfaceItem["category"],
  label: string,
  description: string,
  command: string,
  mode: TreeItemActionSurfaceItem["mode"] = "normal"
): TreeItemActionSurfaceItem {
  return {
    id,
    category,
    label,
    description,
    command,
    mode
  };
}
