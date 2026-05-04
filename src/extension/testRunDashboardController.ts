import * as vscode from "vscode";
import { JsonlLogger } from "../logging/jsonlLogger";
import { KiwiAdapter } from "../adapter/types";
import { KiwiError } from "../domain/errors";
import { diffExecutionResultPatch } from "../domain/executionResultForm";
import { localize } from "./l10n";
import { renderTestRunDashboardWebviewHtml } from "./webview/testRunDashboardView";
import {
  buildCaseSearchQuickPickItems,
  filterCaseSearchMatches
} from "./buildCaseSearchQuickPickItems";
import {
  KiwiBuildOption,
  KiwiCaseExecution,
  KiwiConfig,
  KiwiExecutionStatus,
  KiwiPlan,
  KiwiTestRun,
  KiwiExecutionUpdatePatch,
  KiwiTestRunCreatePayload
} from "../types";

type ClientFactory = () => Promise<{
  adapter: KiwiAdapter;
  config: KiwiConfig;
}>;

type ExecutionRowState = {
  selected: boolean;
  executionId: number;
  caseId: number;
  caseSummary: string;
  status: string;
  comment: string;
  build: string;
  isSaving: boolean;
};

type DashboardState = {
  plans: KiwiPlan[];
  buildOptionsByPlan: Record<string, KiwiBuildOption[]>;
  testRuns: KiwiTestRun[];
  selectedRunId: string;
  statuses: KiwiExecutionStatus[];
  rows: ExecutionRowState[];
  message: string;
  isLoading: boolean;
  createForm: {
    summary: string;
    planId: string;
    buildId: string;
    manager: string;
    isVisible: boolean;
  };
};

type PanelSession = {
  panel: vscode.WebviewPanel;
  state: DashboardState;
  sourceExecutions: KiwiCaseExecution[];
};

export class TestRunDashboardController implements vscode.Disposable {
  private session: PanelSession | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly logger: JsonlLogger,
    private readonly openCaseDocument: (result: { plan: { id: number; name: string }; caseRef: { id: number; summary: string } }) => Promise<vscode.Uri>
  ) {}

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.session?.panel.dispose();
    this.session = undefined;
  }

  async open(): Promise<vscode.WebviewPanel | undefined> {
    return this.openRun();
  }

  async openRun(runId?: number): Promise<vscode.WebviewPanel | undefined> {
    if (this.session) {
      this.session.panel.reveal(this.session.panel.viewColumn, false);
      if (runId !== undefined) {
        await this.openExistingRun(this.session, runId);
      } else {
        await this.reload(this.session);
      }
      return this.session.panel;
    }

    const seed = await this.loadSeedState();

    const panel = vscode.window.createWebviewPanel(
      "kiwiTestRunDashboard",
      localize("Test Run Dashboard"),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    const session: PanelSession = {
      panel,
      state: seed,
      sourceExecutions: []
    };
    this.session = session;
    panel.webview.html = renderTestRunDashboardWebviewHtml(panel.webview, cloneState(session.state));
    const messageDisposable = panel.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(session, message);
    });
    const disposeDisposable = panel.onDidDispose(() => {
      this.session = undefined;
      messageDisposable.dispose();
      disposeDisposable.dispose();
    });
    this.disposables.push(messageDisposable, disposeDisposable);
    this.pushState(session);
    if (runId !== undefined) {
      await this.openExistingRun(session, runId);
    }
    return panel;
  }

  getStateForTest(): DashboardState | undefined {
    if (!this.session) {
      return undefined;
    }
    return cloneState(this.session.state);
  }

  async selectRunForTest(runId: number): Promise<DashboardState> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Test Run dashboard is not open.");
    }
    await this.openExistingRun(this.session, runId);
    return cloneState(this.session.state);
  }

  async saveRowForTest(executionId: number, status: string, comment: string): Promise<KiwiCaseExecution> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Test Run dashboard is not open.");
    }
    return this.saveRow(this.session, executionId, status, comment);
  }

  async openRowForTest(executionId: number): Promise<string | undefined> {
    if (!this.session) {
      return undefined;
    }
    const execution = this.session.sourceExecutions.find((item) => item.id === executionId);
    if (!execution) {
      return undefined;
    }
    const uri = await this.openCaseDocument({
      plan: { id: 0, name: "" },
      caseRef: { id: execution.caseId, summary: execution.caseSummary }
    });
    return uri.toString();
  }

  async createRunForTest(payload: KiwiTestRunCreatePayload): Promise<KiwiTestRun> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Test Run dashboard is not open.");
    }
    return this.createRun(this.session, payload);
  }

  async addCaseToSelectedRunForTest(caseId: number): Promise<DashboardState> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Test Run dashboard is not open.");
    }
    await this.addCaseToSelectedRun(this.session, caseId);
    return cloneState(this.session.state);
  }

  async bulkUpdateForTest(executionIds: number[], status: string): Promise<{ updated: number; failed: number }> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Test Run dashboard is not open.");
    }
    return this.bulkUpdate(this.session, executionIds, status);
  }

  private async handleMessage(session: PanelSession, message: unknown): Promise<void> {
    if (!isMessage(message)) {
      return;
    }

    try {
      switch (message.type) {
        case "reload":
          await this.reload(session);
          break;
        case "openExistingRun":
          await this.promptAndOpenExistingRun(session);
          break;
        case "saveRow":
          await this.saveRow(session, message.executionId, message.status, message.comment);
          break;
        case "createRun":
          await this.createRun(session, {
            summary: message.summary,
            planId: message.planId,
            buildId: message.buildId,
            manager: message.manager
          });
          break;
        case "addCase":
          await this.promptAndAddCaseToSelectedRun(session);
          break;
        case "toggleSelected":
          this.toggleSelected(session, message.executionId, message.selected);
          break;
        case "bulkStatus":
          await this.promptAndBulkUpdateSelected(session);
          break;
        case "openRow":
          await this.openRow(session, message.executionId);
          break;
        case "close":
          session.panel.dispose();
          break;
        default:
          break;
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      session.state.message = text;
      void vscode.window.showErrorMessage(text);
      this.pushState(session);
    }
  }

  private async reload(session: PanelSession): Promise<void> {
    const seed = await this.loadSeedState();
    session.state.plans = seed.plans;
    session.state.buildOptionsByPlan = seed.buildOptionsByPlan;
    session.state.testRuns = seed.testRuns;
    session.state.statuses = seed.statuses;
    session.state.createForm = {
      ...seed.createForm,
      isVisible: session.state.createForm.isVisible
    };
    const currentRunId = Number.parseInt(session.state.selectedRunId || seed.selectedRunId, 10);
    if (Number.isFinite(currentRunId)) {
      await this.loadRunExecutions(session, currentRunId);
      return;
    }
    session.sourceExecutions = [];
    session.state.selectedRunId = "";
    session.state.rows = [];
    session.state.message = seed.message;
    this.pushState(session);
  }

  private async loadSeedState(): Promise<DashboardState> {
    const { adapter, config } = await this.clientFactory();
    const [plans, testRuns, statuses] = await Promise.all([
      adapter.listPlans(config),
      adapter.listTestRuns(config),
      adapter.listExecutionStatuses(config)
    ]);
    const buildOptionsEntries = await Promise.all(
      plans.map(async (plan) => [String(plan.id), await adapter.listBuildsForPlan(config, plan.id)] as const)
    );
    const buildOptionsByPlan = Object.fromEntries(buildOptionsEntries);
    const initialPlanId = plans[0] ? String(plans[0].id) : "";
    const initialBuildId = initialPlanId ? String(buildOptionsByPlan[initialPlanId]?.[0]?.id ?? "") : "";
    return {
      plans,
      buildOptionsByPlan,
      testRuns,
      selectedRunId: "",
      statuses,
      rows: [],
      message:
        testRuns.length === 0
          ? localize("No Test Runs. Create one.")
          : localize("Create a Test Run or open an existing Test Run."),
      isLoading: false,
      createForm: {
        summary: "",
        planId: initialPlanId,
        buildId: initialBuildId,
        manager: config.username,
        isVisible: false
      }
    };
  }

  private async promptAndOpenExistingRun(session: PanelSession): Promise<void> {
    const items = session.state.testRuns.map((run) => ({
      label: `TR${run.id} ${run.summary}`,
      description: findPlanName(session.state.plans, run.planId),
      detail: run.build || "",
      runId: run.id
    }));
    if (items.length === 0) {
      session.state.message = localize("No Test Runs can be opened.");
      this.pushState(session);
      return;
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: localize("Select a Test Run to open"),
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!picked) {
      return;
    }
    await this.openExistingRun(session, picked.runId);
  }

  private async openExistingRun(session: PanelSession, runId: number): Promise<void> {
    this.logInBackground({
      level: "info",
      event: "testrun.open.started",
      source: "runtime",
      operation: "openTestRun",
      entityType: "testRun",
      entityId: String(runId),
      virtualPath: `kiwi:/testruns/${runId}`,
      outcome: "started"
    });
    try {
      await this.loadRunExecutions(session, runId);
    } catch (error) {
      this.logInBackground({
        level: "error",
        event: "testrun.open.failed",
        source: "runtime",
        operation: "openTestRun",
        entityType: "testRun",
        entityId: String(runId),
        virtualPath: `kiwi:/testruns/${runId}`,
        outcome: "failed",
        message: humanMessage(error)
      });
      throw error;
    }
    this.logInBackground({
      level: "info",
      event: "testrun.open.succeeded",
      source: "runtime",
      operation: "openTestRun",
      entityType: "testRun",
      entityId: String(runId),
      virtualPath: `kiwi:/testruns/${runId}`,
      outcome: "succeeded",
      details: `rows=${session.state.rows.length}`
    });
  }

  private async loadRunExecutions(session: PanelSession, runId: number): Promise<void> {
    session.state.isLoading = true;
    session.state.selectedRunId = String(runId);
    session.state.message = localize("Loading Test Run...");
    this.pushState(session);
    try {
      const { adapter, config } = await this.clientFactory();
      const executions = await adapter.listRunExecutions(config, runId);
      session.sourceExecutions = executions.map((item) => ({ ...item }));
      session.state.rows = executions.map((execution) => ({
        selected: false,
        executionId: execution.id,
        caseId: execution.caseId,
        caseSummary: execution.caseSummary,
        status: execution.status,
        comment: execution.comment ?? "",
        build: execution.build,
        isSaving: false
      }));
      session.state.message =
        executions.length === 0
          ? localize("This Test Run has no execution results.")
          : localize("Showing {0} execution results.", executions.length);
    } finally {
      session.state.isLoading = false;
      this.pushState(session);
    }
  }

  private async createRun(
    session: PanelSession,
    payload: KiwiTestRunCreatePayload
  ): Promise<KiwiTestRun> {
    const summary = payload.summary.trim();
    const buildId = payload.buildId;
    const manager = payload.manager.trim();
    if (!summary) {
      throw new KiwiError("ValidationFailed", "Test Run summary is required.");
    }
    if (!Number.isFinite(payload.planId) || payload.planId <= 0) {
      throw new KiwiError("ValidationFailed", "Test Run plan is required.");
    }
    if (!Number.isFinite(buildId) || buildId <= 0) {
      throw new KiwiError("ValidationFailed", "Test Run build is required.");
    }
    const buildName =
      session.state.buildOptionsByPlan[String(payload.planId)]?.find((item) => item.id === buildId)?.name ?? "";
    if (!manager) {
      throw new KiwiError("ValidationFailed", "Test Run manager is required.");
    }
    this.logInBackground({
      level: "info",
      event: "testrun.create.started",
      source: "runtime",
      operation: "createTestRun",
      entityType: "testRun",
      entityId: "pending",
      virtualPath: `kiwi:/testruns/${payload.planId}`,
      outcome: "started",
      details: `summary=${summary} planId=${payload.planId} buildId=${buildId} build=${buildName} manager=${manager}`
    });
    session.state.message = localize("Creating Test Run...");
    this.pushState(session);
    const { adapter, config } = await this.clientFactory();
    let created: KiwiTestRun;
    try {
      created = await adapter.createTestRun(config, {
        summary,
        planId: payload.planId,
        buildId,
        manager
      });
    } catch (error) {
      this.logInBackground({
        level: "error",
        event: "testrun.create.failed",
        source: "runtime",
        operation: "createTestRun",
        entityType: "testRun",
        entityId: "pending",
        virtualPath: `kiwi:/testruns/${payload.planId}`,
        outcome: "failed",
        message: humanMessage(error),
        details: `summary=${summary} planId=${payload.planId} buildId=${buildId} build=${buildName} manager=${manager}`
      });
      throw error;
    }
    const seed = await this.loadSeedState();
    session.state.plans = seed.plans;
    session.state.testRuns = seed.testRuns;
    session.state.statuses = seed.statuses;
    session.state.createForm = {
      summary: "",
      planId: seed.createForm.planId,
      buildId: seed.createForm.buildId,
      manager: seed.createForm.manager,
      isVisible: false
    };
    await this.loadRunExecutions(session, created.id);
    session.state.message = localize("Created Test Run.");
    this.pushState(session);
    this.logInBackground({
      level: "info",
      event: "testrun.create.succeeded",
      source: "runtime",
      operation: "createTestRun",
      entityType: "testRun",
      entityId: String(created.id),
      virtualPath: `kiwi:/testruns/${created.id}`,
      outcome: "succeeded",
      details: `summary=${created.summary} planId=${payload.planId} buildId=${buildId} build=${created.build} manager=${manager}`
    });
    return created;
  }

  private async promptAndAddCaseToSelectedRun(session: PanelSession): Promise<void> {
    const runId = Number.parseInt(session.state.selectedRunId, 10);
    if (!Number.isFinite(runId)) {
      throw new KiwiError("ValidationFailed", "Test Run is not selected.");
    }
    const query = await vscode.window.showInputBox({
      prompt: localize("Enter an existing test case ID or summary to add"),
      placeHolder: localize("Example: 501 / Login")
    });
    if (query === undefined) {
      return;
    }
    const { adapter, config } = await this.clientFactory();
    const plans = await adapter.listPlans(config);
    const entries = await Promise.all(
      plans.map(async (plan) => ({
        plan,
        cases: await adapter.listPlanCases(config, plan.id)
      }))
    );
    const items = buildCaseSearchQuickPickItems(filterCaseSearchMatches(entries, query)).filter(
      (item) => !session.sourceExecutions.some((execution) => execution.caseId === item.caseRef.id)
    );
    if (items.length === 0) {
      session.state.message = localize("No addable test cases were found.");
      this.pushState(session);
      return;
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: localize("Select a test case to add to this Test Run"),
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!picked) {
      return;
    }
    await this.addCaseToSelectedRun(session, picked.caseRef.id);
  }

  private async addCaseToSelectedRun(session: PanelSession, caseId: number): Promise<void> {
    const runId = Number.parseInt(session.state.selectedRunId, 10);
    if (!Number.isFinite(runId)) {
      throw new KiwiError("ValidationFailed", "Test Run is not selected.");
    }
    const { adapter, config } = await this.clientFactory();
    this.logInBackground({
      level: "info",
      event: "testrun.add_case.started",
      source: "runtime",
      operation: "addCaseToRun",
      entityType: "testRun",
      entityId: String(runId),
      virtualPath: `kiwi:/testruns/${runId}`,
      outcome: "started",
      details: `caseId=${caseId}`
    });
    try {
      await adapter.addCaseToRun(config, runId, caseId);
    } catch (error) {
      this.logInBackground({
        level: "error",
        event: "testrun.add_case.failed",
        source: "runtime",
        operation: "addCaseToRun",
        entityType: "testRun",
        entityId: String(runId),
        virtualPath: `kiwi:/testruns/${runId}`,
        outcome: "failed",
        message: humanMessage(error),
        details: `caseId=${caseId}`
      });
      throw error;
    }
    await this.loadRunExecutions(session, runId);
    session.state.message = localize("Added the test case to the Test Run.");
    this.pushState(session);
    this.logInBackground({
      level: "info",
      event: "testrun.add_case.succeeded",
      source: "runtime",
      operation: "addCaseToRun",
      entityType: "testRun",
      entityId: String(runId),
      virtualPath: `kiwi:/testruns/${runId}`,
      outcome: "succeeded",
      details: `caseId=${caseId}`
    });
  }

  private toggleSelected(session: PanelSession, executionId: number, selected: boolean): void {
    const row = session.state.rows.find((item) => item.executionId === executionId);
    if (!row) {
      return;
    }
    row.selected = selected;
    this.pushState(session);
  }

  private async bulkUpdateSelected(session: PanelSession, status: string): Promise<void> {
    const executionIds = session.state.rows.filter((row) => row.selected).map((row) => row.executionId);
    if (executionIds.length === 0) {
      session.state.message = localize("Select rows to bulk update.");
      this.pushState(session);
      return;
    }
    const proceed =
      (await vscode.window.showWarningMessage(
        localize("Update {0} selected execution results to {1}?", executionIds.length, status),
        { modal: true },
        localize("Update")
      )) === localize("Update");
    if (!proceed) {
      return;
    }
    const result = await this.bulkUpdate(session, executionIds, status);
    session.state.message = localize("Bulk status update finished. updated={0}, failed={1}", result.updated, result.failed);
    this.pushState(session);
  }

  private async promptAndBulkUpdateSelected(session: PanelSession): Promise<void> {
    if (session.state.statuses.length === 0) {
      throw new KiwiError("ValidationFailed", "Execution statuses are not available.");
    }
    const picked = await vscode.window.showQuickPick(
      session.state.statuses.map((status) => ({
        label: status.name,
        description: `statusId=${status.id}`,
        statusName: status.name
      })),
      {
        placeHolder: localize("Select a status to apply to selected rows"),
        matchOnDescription: true
      }
    );
    if (!picked) {
      return;
    }
    await this.bulkUpdateSelected(session, picked.statusName);
  }

  private async bulkUpdate(
    session: PanelSession,
    executionIds: number[],
    status: string
  ): Promise<{ updated: number; failed: number }> {
    const runId = Number.parseInt(session.state.selectedRunId, 10);
    this.logInBackground({
      level: "info",
      event: "testrun.bulk_status.started",
      source: "runtime",
      operation: "bulkUpdateExecutionStatus",
      entityType: "testRun",
      entityId: Number.isFinite(runId) ? String(runId) : "unknown",
      virtualPath: Number.isFinite(runId) ? `kiwi:/testruns/${runId}` : "kiwi:/testruns/",
      outcome: "started",
      details: `executionIds=${executionIds.join(",")} status=${status}`
    });
    let updated = 0;
    let failed = 0;
    for (const executionId of executionIds) {
      try {
        await this.saveRow(session, executionId, status, "");
        updated += 1;
      } catch {
        failed += 1;
      }
    }
    this.logInBackground({
      level: failed > 0 ? "warn" : "info",
      event: failed > 0 ? "testrun.bulk_status.failed" : "testrun.bulk_status.succeeded",
      source: "runtime",
      operation: "bulkUpdateExecutionStatus",
      entityType: "testRun",
      entityId: Number.isFinite(runId) ? String(runId) : "unknown",
      virtualPath: Number.isFinite(runId) ? `kiwi:/testruns/${runId}` : "kiwi:/testruns/",
      outcome: failed > 0 ? "failed" : "succeeded",
      details: `executionIds=${executionIds.join(",")} status=${status} updated=${updated} failed=${failed}`
    });
    return { updated, failed };
  }

  private async saveRow(
    session: PanelSession,
    executionId: number,
    status: string,
    comment: string
  ): Promise<KiwiCaseExecution> {
    const index = session.sourceExecutions.findIndex((item) => item.id === executionId);
    if (index === -1) {
      throw new KiwiError("NotFound", `Execution ${executionId} was not found.`);
    }
    const current = session.sourceExecutions[index];
    const patch = diffExecutionResultPatch(
      current,
      {
        status,
        comment
      },
      session.state.statuses
    );
    const row = session.state.rows.find((item) => item.executionId === executionId);
    if (row) {
      row.isSaving = true;
    }
    session.state.message = localize("Saving execution result...");
    this.pushState(session);
    try {
      const { adapter, config } = await this.clientFactory();
      const updated =
        Object.keys(patch).length === 0 ? current : await adapter.updateExecution(config, executionId, patch);
      session.sourceExecutions[index] = { ...updated };
      if (row) {
        row.status = updated.status;
        row.comment = updated.comment ?? "";
      }
      session.state.message = Object.keys(patch).length === 0
        ? localize("No changes.")
        : localize("Saved execution result.");
      return updated;
    } finally {
      if (row) {
        row.isSaving = false;
      }
      this.pushState(session);
    }
  }

  private async openRow(session: PanelSession, executionId: number): Promise<void> {
    const execution = session.sourceExecutions.find((item) => item.id === executionId);
    if (!execution) {
      throw new KiwiError("NotFound", `Execution ${executionId} was not found.`);
    }
    await this.openCaseDocument({
      plan: { id: 0, name: "" },
      caseRef: { id: execution.caseId, summary: execution.caseSummary }
    });
  }

  private pushState(session: PanelSession): void {
    void session.panel.webview.postMessage({
      type: "state",
      state: cloneState(session.state)
    });
  }

  private logInBackground(event: {
    level: "debug" | "info" | "warn" | "error";
    event: string;
    source: "runtime";
    operation: string;
    entityType: string;
    entityId: string;
    virtualPath: string;
    outcome: "started" | "succeeded" | "failed";
    errorCode?: string;
    message?: string;
    details?: string;
  }): void {
    void this.logger.log(event).catch(() => undefined);
  }
}

function cloneState(state: DashboardState): DashboardState {
  return {
    plans: state.plans.map((item) => ({ ...item })),
    buildOptionsByPlan: Object.fromEntries(
      Object.entries(state.buildOptionsByPlan).map(([planId, items]) => [
        planId,
        items.map((item) => ({ ...item }))
      ])
    ),
    testRuns: state.testRuns.map((item) => ({ ...item })),
    selectedRunId: state.selectedRunId,
    statuses: state.statuses.map((item) => ({ ...item })),
    rows: state.rows.map((item) => ({ ...item })),
    message: state.message,
    isLoading: state.isLoading,
    createForm: { ...state.createForm }
  };
}

function humanMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMessage(value: unknown): value is
  | { type: "reload" }
  | { type: "close" }
  | { type: "openExistingRun" }
  | { type: "openRow"; executionId: number }
  | { type: "saveRow"; executionId: number; status: string; comment: string }
  | { type: "createRun"; summary: string; planId: number; buildId: number; manager: string }
  | { type: "addCase" }
  | { type: "toggleSelected"; executionId: number; selected: boolean }
  | { type: "bulkStatus" } {
  return Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string");
}

function findPlanName(plans: KiwiPlan[], planId: number | undefined): string {
  if (!Number.isFinite(planId)) {
    return "";
  }
  return plans.find((plan) => plan.id === planId)?.name ?? "";
}
