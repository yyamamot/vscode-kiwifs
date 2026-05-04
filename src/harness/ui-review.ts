export type UiReviewResult = "pass" | "needs-fix" | "human-review";
export type UiReviewSeverity = "error" | "warning" | "info";

export interface UiReviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface UiReviewElement {
  reviewId: string;
  tagName: string;
  role: string;
  label: string;
  visible: boolean;
  disabled: boolean;
  rect: UiReviewRect;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  className?: string;
  action?: string;
}

export interface UiReviewGeometry {
  viewport: {
    width: number;
    height: number;
  };
  elements: UiReviewElement[];
}

export interface UiReviewSnapshot {
  capturedAt: string;
  reason: string;
  selfReview: {
    screen: "case-filter" | "test-run-filter";
    hasResults: boolean;
    selectedCount: number;
    resultCount: number;
    [key: string]: unknown;
  };
  geometry: UiReviewGeometry;
}

export interface UiReviewCheck {
  id: string;
  severity: UiReviewSeverity;
  passed: boolean;
  summary: string;
  evidence?: string;
}

export interface UiReviewScenarioResult {
  id: string;
  result: UiReviewResult;
  checks: UiReviewCheck[];
  artifactPaths: Record<string, string>;
  evidenceLayers?: UiReviewEvidenceLayer[];
  nativeContextMenus?: UiReviewNativeContextMenuEvidence[];
}

export interface UiReviewReport {
  result: UiReviewResult;
  scenarioResults: UiReviewScenarioResult[];
  findings: UiReviewCheck[];
  humanReviewNeeded: string[];
  artifactPaths: Record<string, string>;
}

export interface UiReviewEvidenceLayer {
  name: string;
  source: string;
  role: string;
  status: "supporting" | "stable" | "source-of-truth";
}

export interface UiReviewMenuContribution {
  command: string;
  title?: string;
  when?: string;
  group?: string;
}

export interface UiReviewActionSurfaceEvidence {
  target: string;
  title?: string;
  overview?: {
    title?: string;
    rows?: Array<{ label: string; value: string }>;
  };
  items: Array<{
    id: string;
    category: string;
    label: string;
    description?: string;
    command: string;
    mode: string;
  }>;
  screenshot?: string;
}

export interface UiReviewNativeContextMenuEvidence {
  name: string;
  target: string;
  status: "captured-unverified" | "capture-failed" | "not-supported";
  screenshot?: string;
  metadata?: string;
  reason?: string;
}

export interface UiReviewMenuState {
  capturedAt: string;
  scenarioId: string;
  menus: {
    viewItemContext: UiReviewMenuContribution[];
    commandPalette: UiReviewMenuContribution[];
  };
  actionSurfaces?: UiReviewActionSurfaceEvidence[];
  nativeContextMenus?: UiReviewNativeContextMenuEvidence[];
}

const REQUIRED_VISIBLE_REVIEW_IDS = ["shell", "filter-form", "result-list"] as const;
const MAJOR_OVERFLOW_REVIEW_IDS = new Set(["shell", "filter-form", "result-list", "bulk-actions"]);
const JAPANESE_TEXT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;
const PLAN_CONTEXT_WHEN = "view == kiwiPlans && viewItem == plan";
const CASE_CONTEXT_WHEN = "view == kiwiPlans && viewItem == caseDocument";
const REQUIRED_PLAN_COMMANDS = [
  "kiwi.openPlanInBrowser",
  "kiwi.showPlanTreeItemActions",
  "kiwi.createCase",
  "kiwi.addExistingCaseToPlan",
  "kiwi.downloadPlanToLocalMirror",
  "kiwi.comparePlanLocalMirror"
] as const;
const REQUIRED_CASE_COMMANDS = [
  "kiwi.openInBrowser",
  "kiwi.refreshCaseDocument",
  "kiwi.editCaseMetadata",
  "kiwi.manageCaseExecutionsAcrossRuns",
  "kiwi.showCaseTreeItemActions",
  "kiwi.downloadCaseToLocalMirror",
  "kiwi.compareLocalMirror",
  "kiwi.removeCaseFromPlan",
  "kiwi.deleteCase"
] as const;
const FORBIDDEN_TREEVIEW_CONTEXT_COMMANDS = [
  "kiwi.uploadPlanLocalMirror",
  "kiwi.uploadLocalMirror",
  "kiwi.revealLocalMirror",
  "kiwi.showTreeItemActions"
] as const;
const COMMAND_PALETTE_HIDDEN_COMMANDS = [
  "kiwi.deleteCase",
  "kiwi.removeCaseFromPlanFromPlan",
  "kiwi.uploadLocalMirror",
  "kiwi.uploadPlanLocalMirror",
  "kiwi.scmUploadLocalMirrorResources",
  "kiwi.scmCompareLocalMirrorAgain",
  "kiwi.scmCheckRemoteLocalMirrorMetadata",
  "kiwi.scmTakeRemoteLocalMirrorResources",
  "kiwi.showTreeItemActions",
  "kiwi.showPlanTreeItemActions",
  "kiwi.showCaseTreeItemActions"
] as const;

export function evaluateUiReviewSnapshot(snapshot: UiReviewSnapshot): UiReviewCheck[] {
  const checks: UiReviewCheck[] = [];
  const visibleElements = snapshot.geometry.elements.filter((element) => element.visible);
  const byReviewId = new Map(snapshot.geometry.elements.map((element) => [element.reviewId, element]));

  for (const reviewId of REQUIRED_VISIBLE_REVIEW_IDS) {
    const element = byReviewId.get(reviewId);
    checks.push({
      id: `required-visible-${reviewId}`,
      severity: "error",
      passed: Boolean(element?.visible && element.rect.width > 0 && element.rect.height > 0),
      summary: `${reviewId} must be visible and non-empty.`
    });
  }

  if (snapshot.selfReview.screen === "case-filter") {
    const bulkActions = byReviewId.get("bulk-actions");
    checks.push({
      id: "required-present-bulk-actions",
      severity: "error",
      passed: Boolean(bulkActions && bulkActions.rect.width > 0 && bulkActions.rect.height > 0),
      summary: "bulk-actions must be present and measurable."
    });
  }

  for (const element of visibleElements) {
    if (element.rect.width <= 0 || element.rect.height <= 0) {
      checks.push({
        id: `nonzero-${element.reviewId}`,
        severity: "error",
        passed: false,
        summary: `Visible element ${element.reviewId} has zero size.`
      });
    }

    if (isOutsideViewport(element, snapshot.geometry.viewport)) {
      checks.push({
        id: `viewport-${element.reviewId}`,
        severity: "error",
        passed: false,
        summary: `Visible element ${element.reviewId} is outside the viewport.`
      });
    }

    if (isClippingCandidate(element) && hasScrollableOverflow(element)) {
      checks.push({
        id: `clipping-${element.reviewId}`,
        severity: "error",
        passed: false,
        summary: `Text or content may be clipped in ${element.reviewId}.`,
        evidence: `scroll=${element.scrollWidth}x${element.scrollHeight}, client=${element.clientWidth}x${element.clientHeight}`
      });
    }

    if (MAJOR_OVERFLOW_REVIEW_IDS.has(element.reviewId) && hasScrollableOverflow(element)) {
      checks.push({
        id: `overflow-${element.reviewId}`,
        severity: "error",
        passed: false,
        summary: `Major UI region ${element.reviewId} overflows its own bounds.`,
        evidence: `scroll=${element.scrollWidth}x${element.scrollHeight}, client=${element.clientWidth}x${element.clientHeight}`
      });
    }

    if (hasJapaneseText(element.label)) {
      checks.push({
        id: `l10n-no-japanese-${element.reviewId}`,
        severity: "error",
        passed: false,
        summary: `Visible element ${element.reviewId} contains Japanese text in an English UI review run.`,
        evidence: element.label
      });
    }
  }

  return checks.length === 0
    ? [{ id: "ui-review-no-findings", severity: "info", passed: true, summary: "No deterministic UI review findings." }]
    : checks;
}

export function resultForUiReviewChecks(checks: UiReviewCheck[]): UiReviewResult {
  if (checks.some((check) => !check.passed && check.severity === "error")) {
    return "needs-fix";
  }
  return "pass";
}

export function evaluateTreeViewContextMenuState(state: UiReviewMenuState): UiReviewCheck[] {
  const checks: UiReviewCheck[] = [];
  const contextMenus = state.menus.viewItemContext;
  const planMenus = contextMenus.filter((item) => item.when === PLAN_CONTEXT_WHEN);
  const caseMenus = contextMenus.filter((item) => item.when === CASE_CONTEXT_WHEN);

  checks.push(...requiredCommandChecks("plan", planMenus, REQUIRED_PLAN_COMMANDS));
  checks.push(...requiredCommandChecks("case", caseMenus, REQUIRED_CASE_COMMANDS));
  checks.push(...forbiddenTreeViewCommandChecks(contextMenus));
  checks.push(...whenClauseChecks(contextMenus));
  checks.push(...deleteCaseChecks(contextMenus));
  checks.push(...commandPaletteChecks(state.menus.commandPalette));
  checks.push(...actionSurfaceChecks(state.actionSurfaces ?? []));
  checks.push(...nativeContextMenuChecks(state.nativeContextMenus ?? []));

  return checks.length === 0
    ? [{ id: "treeview-menu-no-findings", severity: "info", passed: true, summary: "No deterministic TreeView menu findings." }]
    : checks;
}

export function createUiReviewReport(
  scenarioResults: UiReviewScenarioResult[],
  artifactPaths: Record<string, string> = {}
): UiReviewReport {
  const findings = scenarioResults.flatMap((scenario) =>
    scenario.checks
      .filter((check) => !check.passed)
      .map((check) => ({
        ...check,
        id: `${scenario.id}:${check.id}`
      }))
  );
  return {
    result: findings.some((finding) => finding.severity === "error") ? "needs-fix" : "pass",
    scenarioResults,
    findings,
    humanReviewNeeded: [
      "Native VS Code Webview focus behavior",
      "Long-session visual fatigue",
      "Mouse hover and tooltip timing"
    ],
    artifactPaths
  };
}

function requiredCommandChecks(
  target: "plan" | "case",
  menus: UiReviewMenuContribution[],
  requiredCommands: readonly string[]
): UiReviewCheck[] {
  const commands = menus.map((item) => item.command);
  return requiredCommands.map((command) => ({
    id: `treeview-${target}-required-${command}`,
    severity: "error" as const,
    passed: commands.includes(command),
    summary: `${target} context menu must include ${command}.`
  }));
}

function whenClauseChecks(menus: UiReviewMenuContribution[]): UiReviewCheck[] {
  return menus
    .filter((item) => item.when?.includes("view == kiwiPlans"))
    .map((item) => ({
      id: `treeview-menu-when-${item.command}`,
      severity: "error" as const,
      passed: item.when === PLAN_CONTEXT_WHEN || item.when === CASE_CONTEXT_WHEN,
      summary: `${item.command} must be scoped to plan or caseDocument TreeView items.`,
      evidence: `when=${item.when ?? ""}`
    }));
}

function forbiddenTreeViewCommandChecks(menus: UiReviewMenuContribution[]): UiReviewCheck[] {
  const commands = new Set(menus.map((item) => item.command));
  return FORBIDDEN_TREEVIEW_CONTEXT_COMMANDS.map((command) => ({
    id: `treeview-forbidden-${command}`,
    severity: "error" as const,
    passed: !commands.has(command),
    summary: `${command} must not be directly contributed to the TreeView context menu.`
  }));
}

function deleteCaseChecks(menus: UiReviewMenuContribution[]): UiReviewCheck[] {
  const deleteMenus = menus.filter((item) => item.command === "kiwi.deleteCase");
  return [
    {
      id: "treeview-delete-case-only-case-item",
      severity: "error" as const,
      passed: deleteMenus.length === 1 && deleteMenus[0]?.when === CASE_CONTEXT_WHEN,
      summary: "kiwi.deleteCase must be contributed only to case context menu."
    },
    {
      id: "treeview-delete-case-group",
      severity: "error" as const,
      passed: deleteMenus[0]?.group === "06_danger@2",
      summary: "kiwi.deleteCase must stay in the delete/remove group after remove-from-plan."
    }
  ];
}

function commandPaletteChecks(commandPalette: UiReviewMenuContribution[]): UiReviewCheck[] {
  return COMMAND_PALETTE_HIDDEN_COMMANDS.map((command) => {
    const item = commandPalette.find((entry) => entry.command === command);
    return {
      id: `treeview-command-palette-hidden-${command}`,
      severity: "error" as const,
      passed: item?.when === "false",
      summary: `${command} must be hidden from the Command Palette.`
    };
  });
}

function actionSurfaceChecks(actionSurfaces: UiReviewActionSurfaceEvidence[]): UiReviewCheck[] {
  const checks: UiReviewCheck[] = ["plan", "case"].map((target) => {
    const surface = actionSurfaces.find((entry) => entry.target === target);
    return {
      id: `treeview-action-surface-${target}`,
      severity: "error" as const,
      passed: Boolean(surface && surface.items.length > 0 && surface.screenshot),
      summary: `${target} action surface Webview evidence must be captured.`
    };
  });
  const planSurface = actionSurfaces.find((entry) => entry.target === "plan");
  const planOverviewLabels = new Set((planSurface?.overview?.rows ?? []).map((row) => row.label));
  checks.push({
    id: "treeview-action-surface-plan-overview",
    severity: "error" as const,
    passed: Boolean(
      planSurface &&
      hasAnyLabel(planOverviewLabels, ["Test Plan ID", "テスト計画ID"]) &&
      hasAnyLabel(planOverviewLabels, ["Name", "名前"]) &&
      hasAnyLabel(planOverviewLabels, ["Description", "説明"]) &&
      hasAnyLabel(planOverviewLabels, ["Child Test Cases", "配下テストケース数"]) &&
      hasAnyLabel(planOverviewLabels, ["Test Runs", "テスト実行数"]) &&
      hasAnyLabel(planOverviewLabels, ["Local Mirror", "ローカルミラー"])
    ),
    summary: "plan action surface must show plan ID, name, text, case count, test run count, and local mirror summary in the overview."
  });
  checks.push({
    id: "treeview-action-surface-plan-no-show-info-item",
    severity: "error" as const,
    passed: !planSurface?.items.some((item) => item.command === "kiwi.showPlanInfo"),
    summary: "plan action surface must not duplicate plan info as an action item."
  });
  const caseSurface = actionSurfaces.find((entry) => entry.target === "case");
  const caseExecutionResult = caseSurface?.items.find((item) => item.command === "kiwi.recordCaseExecutionResult");
  const caseExecutionBoard = caseSurface?.items.find((item) => item.command === "kiwi.manageCaseExecutionsAcrossRuns");
  checks.push({
    id: "treeview-action-surface-case-test-execution-labels",
    severity: "error" as const,
    passed: matchesAnyLabel(caseExecutionResult?.label, ["Update Test Execution Result", "テスト実行結果を更新"]) &&
      caseExecutionResult?.category === "execution" &&
      matchesAnyLabel(caseExecutionBoard?.label, ["Manage Test Executions", "テスト実行を管理"]) &&
      caseExecutionBoard?.category === "execution",
    summary: "case action surface must label Test Run/TestExecution actions consistently."
  });
  checks.push(...noJapaneseActionSurfaceChecks(actionSurfaces));
  return checks;
}

function noJapaneseActionSurfaceChecks(actionSurfaces: UiReviewActionSurfaceEvidence[]): UiReviewCheck[] {
  return actionSurfaces.flatMap((surface) => {
    const texts = [
      surface.title,
      surface.overview?.title,
      ...(surface.overview?.rows ?? []).flatMap((row) => [row.label, row.value]),
      ...surface.items.flatMap((item) => [item.category, item.label, item.description, item.command, item.mode])
    ].filter((text): text is string => Boolean(text));
    const japaneseTexts = texts.filter(hasJapaneseText);
    return [{
      id: `treeview-action-surface-${surface.target}-l10n-no-japanese`,
      severity: "error" as const,
      passed: japaneseTexts.length === 0,
      summary: `${surface.target} action surface must not contain Japanese text in an English UI review run.`,
      evidence: japaneseTexts.join(" | ")
    }];
  });
}

function hasAnyLabel(labels: Set<string>, expected: readonly string[]): boolean {
  return expected.some((label) => labels.has(label));
}

function matchesAnyLabel(actual: string | undefined, expected: readonly string[]): boolean {
  return actual !== undefined && expected.includes(actual);
}

function hasJapaneseText(value: string | undefined): boolean {
  return Boolean(value && JAPANESE_TEXT_PATTERN.test(value));
}

function nativeContextMenuChecks(
  nativeContextMenus: UiReviewNativeContextMenuEvidence[]
): UiReviewCheck[] {
  return nativeContextMenus.map((entry) => ({
    id: `treeview-native-context-menu-${entry.target}`,
    severity: "info" as const,
    passed: entry.status === "captured-unverified",
    summary: `Native context menu evidence for ${entry.target}: ${entry.status}.`,
    evidence: entry.reason
  }));
}

function isClippingCandidate(element: UiReviewElement): boolean {
  return element.tagName === "BUTTON" ||
    element.tagName === "SELECT" ||
    element.tagName === "INPUT" ||
    element.role === "button" ||
    element.role === "menuitem" ||
    element.role === "tab";
}

function hasScrollableOverflow(element: UiReviewElement): boolean {
  return element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2;
}

function isOutsideViewport(
  element: UiReviewElement,
  viewport: UiReviewGeometry["viewport"]
): boolean {
  return element.rect.right < -1 ||
    element.rect.bottom < -1 ||
    element.rect.left > viewport.width + 1 ||
    element.rect.top > viewport.height + 1;
}
