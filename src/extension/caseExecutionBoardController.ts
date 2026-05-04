import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { KiwiError } from "../domain/errors";
import { diffExecutionResultPatch } from "../domain/executionResultForm";
import { JsonlLogger } from "../logging/jsonlLogger";
import { KiwiBuildOption, KiwiCaseExecution, KiwiConfig, KiwiExecutionStatus, KiwiPlan, KiwiTestRun } from "../types";
import { localize } from "./l10n";
import { renderCaseExecutionBoardWebviewHtml } from "./webview/caseExecutionBoardView";
import { escapeHtml } from "./webview/webviewUtils";
import {
  buildRegisteredCaseExecutionBoardGroups,
  CaseExecutionBoardGroup,
  CaseExecutionBoardRow
} from "./buildCaseExecutionBoardState";

type ClientFactory = () => Promise<{
  adapter: KiwiAdapter;
  config: KiwiConfig;
}>;

export type CaseExecutionBoardTarget = {
  plan: { id: number; name: string };
  caseRef: { id: number; summary: string };
};

type BoardState = {
  target: CaseExecutionBoardTarget;
  plans: KiwiPlan[];
  buildOptionsByPlan: Record<string, KiwiBuildOption[]>;
  groups: CaseExecutionBoardGroup[];
  statuses: KiwiExecutionStatus[];
  message: string;
  isLoading: boolean;
  addSection: {
    createForm: {
      summary: string;
      planId: string;
      buildId: string;
      manager: string;
      isVisible: boolean;
    };
  };
};

type PanelSession = {
  panel: vscode.WebviewPanel;
  state: BoardState;
  sourceRegisteredRuns: KiwiTestRun[];
  sourceExecutions: KiwiCaseExecution[];
};

export class CaseExecutionBoardController implements vscode.Disposable {
  private readonly sessions = new Map<string, PanelSession>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly logger: JsonlLogger,
    private readonly openCaseDocument: (result: {
      plan: { id: number; name: string };
      caseRef: { id: number; summary: string };
    }) => Promise<vscode.Uri>
  ) {}

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    for (const session of this.sessions.values()) {
      session.panel.dispose();
    }
    this.sessions.clear();
  }

  async open(target: CaseExecutionBoardTarget): Promise<vscode.WebviewPanel> {
    const key = String(target.caseRef.id);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn, false);
      await this.reload(existing);
      return existing.panel;
    }

    const panel = vscode.window.createWebviewPanel(
      "kiwiCaseExecutionBoard",
      panelTitle(target),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    const session: PanelSession = {
      panel,
      state: {
        target,
        plans: [],
        buildOptionsByPlan: {},
        groups: [],
        statuses: [],
        message: localize("Loading Test Runs..."),
        isLoading: true,
        addSection: {
          createForm: {
            summary: "",
            planId: String(target.plan.id),
            buildId: "",
            manager: "",
            isVisible: false
          }
        }
      },
      sourceRegisteredRuns: [],
      sourceExecutions: []
    };
    this.sessions.set(key, session);
    panel.webview.html = renderCaseExecutionBoardWebviewHtml(panel.webview, panelTitle(session.state.target), cloneBoardState(session.state));
    const messageDisposable = panel.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(session, message);
    });
    const disposeDisposable = panel.onDidDispose(() => {
      this.sessions.delete(key);
      messageDisposable.dispose();
      disposeDisposable.dispose();
    });
    this.disposables.push(messageDisposable, disposeDisposable);
    const openedAt = Date.now();
    await this.reload(session);
    this.log({
      level: "info",
      event: "case-execution-board.opened",
      operation: "openCaseExecutionBoard",
      entityId: String(target.caseRef.id),
      virtualPath: `kiwi:/cases/${target.caseRef.id}/executions`,
      outcome: "succeeded",
      details: `caseId=${target.caseRef.id} summary=${target.caseRef.summary} openMs=${Date.now() - openedAt}`
    });
    return panel;
  }

  getStateForTest(caseId: number): BoardState | undefined {
    const session = this.sessions.get(String(caseId));
    return session ? cloneBoardState(session.state) : undefined;
  }

  async createRunForTest(caseId: number, payload: { planId?: number; summary: string; buildId: number; manager: string }) {
    const session = this.sessions.get(String(caseId));
    if (!session) {
      throw new KiwiError("ValidationFailed", "Case execution board is not open.");
    }
    return this.createRun(session, payload);
  }

  async addRunForTest(caseId: number, runId: number) {
    const session = this.sessions.get(String(caseId));
    if (!session) {
      throw new KiwiError("ValidationFailed", "Case execution board is not open.");
    }
    return this.addCaseToRun(session, runId);
  }

  async saveRowForTest(caseId: number, runId: number, status: string, comment: string) {
    const session = this.sessions.get(String(caseId));
    if (!session) {
      throw new KiwiError("ValidationFailed", "Case execution board is not open.");
    }
    return this.saveRow(session, runId, status, comment);
  }

  async openRowForTest(caseId: number, runId: number): Promise<string | undefined> {
    const session = this.sessions.get(String(caseId));
    if (!session) {
      return undefined;
    }
    const row = findRow(session.state, runId);
    if (!row) {
      return undefined;
    }
    const uri = await this.openCaseDocument(session.state.target);
    return uri.toString();
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
        case "toggleCreateForm":
          session.state.addSection.createForm.isVisible = !session.state.addSection.createForm.isVisible;
          if (session.state.addSection.createForm.isVisible) {
            await this.ensureCreateFormSeed(session);
          }
          this.pushState(session);
          break;
        case "changeCreatePlan":
          await this.changeCreatePlan(session, message.planId);
          this.pushState(session);
          break;
        case "addExistingRun":
          await this.promptAndAddRun(session);
          break;
        case "createRun":
          await this.createRun(session, message);
          break;
        case "saveRow":
          await this.saveRow(session, message.runId, message.status, message.comment);
          break;
        case "openRow":
          await this.openRow(session, message.runId);
          break;
        case "close":
          session.panel.dispose();
          break;
        default:
          break;
      }
    } catch (error) {
      const text = humanMessage(error);
      session.state.message = text;
      void vscode.window.showErrorMessage(text);
      this.pushState(session);
    }
  }

  private async reload(session: PanelSession): Promise<void> {
    session.state.isLoading = true;
    session.state.message = localize("Loading Test Runs...");
    this.pushState(session);

    await this.refreshBoardData(session, { includeBuilds: true, includeStatuses: true });
  }

  private async refreshBoardData(
    session: PanelSession,
    options: { includeBuilds: boolean; includeStatuses: boolean }
  ): Promise<void> {
    const { adapter, config } = await this.clientFactory();
    const [registeredRuns, executions, statuses, buildOptions] = await Promise.all([
      adapter.listRegisteredRunsForCase(config, session.state.target.caseRef.id),
      adapter.listCaseExecutions(config, session.state.target.caseRef.id),
      options.includeStatuses ? adapter.listExecutionStatuses(config) : Promise.resolve(session.state.statuses),
      options.includeBuilds
        ? adapter.listBuildsForPlan(config, session.state.target.plan.id)
        : Promise.resolve(session.state.buildOptionsByPlan[String(session.state.target.plan.id)] ?? [])
    ]);
    const currentForm = session.state.addSection.createForm;
    const initialBuildId = currentForm.buildId || String(buildOptions[0]?.id ?? "");

    session.sourceRegisteredRuns = registeredRuns;
    session.sourceExecutions = executions;
    session.state.buildOptionsByPlan = {
      ...session.state.buildOptionsByPlan,
      [String(session.state.target.plan.id)]: buildOptions
    };
    session.state.groups = buildRegisteredCaseExecutionBoardGroups({
      runs: registeredRuns,
      executions
    });
    session.state.statuses = statuses;
    session.state.addSection = {
      createForm: {
        summary: currentForm.summary,
        planId: currentForm.planId || String(session.state.target.plan.id),
        buildId: initialBuildId,
        manager: currentForm.manager || config.username,
        isVisible: currentForm.isVisible
      }
    };
    session.state.isLoading = false;
    session.state.message =
      executions.length === 0
        ? localize("This test case is not registered in any Test Run yet.")
        : localize("There are {0} registered execution results.", executions.length);
    this.pushState(session);
  }

  private async promptAndAddRun(session: PanelSession): Promise<void> {
    const query = await vscode.window.showInputBox({
      prompt: localize("Enter a Test Run ID or summary to add"),
      placeHolder: localize("Example: 301 / nightly")
    });
    if (query === undefined) {
      return;
    }
    const { adapter, config } = await this.clientFactory();
    const registeredRunIds = new Set(session.sourceExecutions.map((execution) => execution.runId));
    const items = (await adapter.searchTestRuns(config, {
      query
    }))
      .filter((run) => !registeredRunIds.has(run.id))
      .map((run) => ({
        label: `TR${run.id} ${run.summary}`,
        description: run.planId !== undefined ? `${run.planId} - ${run.planName ?? `Plan ${run.planId}`}` : "",
        detail: run.build ? `build: ${run.build}` : "",
        run
      }));
    if (items.length === 0) {
      session.state.message = localize("No addable Test Runs were found.");
      this.pushState(session);
      return;
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: localize("Select a Test Run to add this test case to"),
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!picked) {
      return;
    }
    await this.addCaseToRun(session, picked.run.id);
  }

  private async createRun(
    session: PanelSession,
    payload: { planId?: number; summary: string; buildId: number; manager: string }
  ): Promise<KiwiTestRun> {
    const summary = payload.summary.trim();
    const manager = payload.manager.trim();
    const buildId = payload.buildId;
    const planId = payload.planId ?? Number(session.state.addSection.createForm.planId);
    if (!summary) {
      throw new KiwiError("ValidationFailed", "Test Run summary is required.");
    }
    if (!Number.isFinite(planId) || planId <= 0) {
      throw new KiwiError("ValidationFailed", "Test Run plan is required.");
    }
    if (!Number.isFinite(buildId) || buildId <= 0) {
      throw new KiwiError("ValidationFailed", "Test Run build is required.");
    }
    if (!manager) {
      throw new KiwiError("ValidationFailed", "Test Run manager is required.");
    }
    const buildName = (session.state.buildOptionsByPlan[String(planId)] ?? []).find((item) => item.id === buildId)?.name ?? "";
    this.log({
      level: "info",
      event: "case-execution-board.create_run.started",
      operation: "createRun",
      entityId: String(planId),
      virtualPath: `kiwi:/cases/${session.state.target.caseRef.id}/executions`,
      outcome: "started",
      details: `caseId=${session.state.target.caseRef.id} planId=${planId} summary=${summary} buildId=${buildId} build=${buildName} manager=${manager}`
    });
    const { adapter, config } = await this.clientFactory();
    let created: KiwiTestRun;
    try {
      created = await adapter.createTestRun(config, {
        summary,
        planId,
        buildId,
        manager
      });
      await adapter.addCaseToRun(config, created.id, session.state.target.caseRef.id);
    } catch (error) {
      this.log({
        level: "error",
        event: "case-execution-board.create_run.failed",
        operation: "createRun",
        entityId: String(planId),
        virtualPath: `kiwi:/cases/${session.state.target.caseRef.id}/executions`,
        outcome: "failed",
        message: humanMessage(error),
        details: `caseId=${session.state.target.caseRef.id} planId=${planId} summary=${summary} buildId=${buildId} build=${buildName} manager=${manager}`
      });
      throw error;
    }
    session.state.addSection.createForm = {
      summary: "",
      planId: String(planId),
      buildId: String(buildId),
      manager,
      isVisible: false
    };
    await this.refreshBoardData(session, { includeBuilds: false, includeStatuses: false });
    this.log({
      level: "info",
      event: "case-execution-board.create_run.succeeded",
      operation: "createRun",
      entityId: String(created.id),
      virtualPath: `kiwi:/cases/${session.state.target.caseRef.id}/executions`,
      outcome: "succeeded",
      details: `caseId=${session.state.target.caseRef.id} runId=${created.id} planId=${planId} build=${created.build}`
    });
    return created;
  }

  private async addCaseToRun(session: PanelSession, runId: number): Promise<BoardState> {
    this.log({
      level: "info",
      event: "case-execution-board.add_case.started",
      operation: "addCaseToRun",
      entityId: String(runId),
      virtualPath: `kiwi:/cases/${session.state.target.caseRef.id}/executions`,
      outcome: "started",
      details: `caseId=${session.state.target.caseRef.id} runId=${runId}`
    });
    const { adapter, config } = await this.clientFactory();
    try {
      await adapter.addCaseToRun(config, runId, session.state.target.caseRef.id);
    } catch (error) {
      this.log({
        level: "error",
        event: "case-execution-board.add_case.failed",
        operation: "addCaseToRun",
        entityId: String(runId),
        virtualPath: `kiwi:/cases/${session.state.target.caseRef.id}/executions`,
        outcome: "failed",
        message: humanMessage(error),
        details: `caseId=${session.state.target.caseRef.id} runId=${runId}`
      });
      throw error;
    }
    await this.refreshBoardData(session, { includeBuilds: false, includeStatuses: false });
    this.log({
      level: "info",
      event: "case-execution-board.add_case.succeeded",
      operation: "addCaseToRun",
      entityId: String(runId),
      virtualPath: `kiwi:/cases/${session.state.target.caseRef.id}/executions`,
      outcome: "succeeded",
      details: `caseId=${session.state.target.caseRef.id} runId=${runId}`
    });
    return cloneBoardState(session.state);
  }

  private async saveRow(session: PanelSession, runId: number, status: string, comment: string): Promise<KiwiCaseExecution> {
    const row = findRow(session.state, runId);
    if (!row) {
      throw new KiwiError("ValidationFailed", "Execution row is not available.");
    }
    const current = session.sourceExecutions.find((item) => item.id === row.executionId);
    if (!current) {
      throw new KiwiError("NotFound", `Execution ${row.executionId} was not found.`);
    }
    const patch = diffExecutionResultPatch(current, { status, comment }, session.state.statuses);
    this.log({
      level: "info",
      event: "case-execution-board.save_execution.started",
      operation: "saveExecution",
      entityId: String(row.executionId),
      virtualPath: `kiwi:/cases/${session.state.target.caseRef.id}/executions`,
      outcome: "started",
      details: `caseId=${session.state.target.caseRef.id} runId=${runId} executionId=${row.executionId} status=${status.trim()}`
    });
    const { adapter, config } = await this.clientFactory();
    let updated: KiwiCaseExecution;
    try {
      updated = Object.keys(patch).length === 0 ? current : await adapter.updateExecution(config, row.executionId, patch);
    } catch (error) {
      this.log({
        level: "error",
        event: "case-execution-board.save_execution.failed",
        operation: "saveExecution",
        entityId: String(row.executionId),
        virtualPath: `kiwi:/cases/${session.state.target.caseRef.id}/executions`,
        outcome: "failed",
        message: humanMessage(error),
        details: `caseId=${session.state.target.caseRef.id} runId=${runId} executionId=${row.executionId} status=${status.trim()}`
      });
      throw error;
    }
    await this.refreshBoardData(session, { includeBuilds: false, includeStatuses: false });
    this.log({
      level: "info",
      event: "case-execution-board.save_execution.succeeded",
      operation: "saveExecution",
      entityId: String(updated.id),
      virtualPath: `kiwi:/cases/${session.state.target.caseRef.id}/executions`,
      outcome: "succeeded",
      details: `caseId=${session.state.target.caseRef.id} runId=${runId} executionId=${updated.id} status=${updated.status}`
    });
    return updated;
  }

  private async ensureCreateFormSeed(session: PanelSession): Promise<void> {
    const planId = Number(session.state.addSection.createForm.planId || session.state.target.plan.id);
    const loadPlans = session.state.plans.length === 0;
    const loadBuilds = !session.state.buildOptionsByPlan[String(planId)];
    if (!loadPlans && !loadBuilds) {
      return;
    }
    const { adapter, config } = await this.clientFactory();
    const [plans, builds] = await Promise.all([
      loadPlans ? adapter.listPlans(config) : Promise.resolve(session.state.plans),
      loadBuilds ? adapter.listBuildsForPlan(config, planId) : Promise.resolve(session.state.buildOptionsByPlan[String(planId)] ?? [])
    ]);
    session.state.plans = plans;
    session.state.buildOptionsByPlan = {
      ...session.state.buildOptionsByPlan,
      ...(loadBuilds ? { [String(planId)]: builds } : {})
    };
    if (!session.state.addSection.createForm.planId) {
      session.state.addSection.createForm.planId = String(planId);
    }
    if (!session.state.addSection.createForm.buildId) {
      session.state.addSection.createForm.buildId = String((session.state.buildOptionsByPlan[String(planId)] ?? [])[0]?.id ?? "");
    }
  }

  private async changeCreatePlan(session: PanelSession, planId: number): Promise<void> {
    if (!Number.isFinite(planId) || planId <= 0) {
      throw new KiwiError("ValidationFailed", "Test Run plan is required.");
    }
    session.state.addSection.createForm.planId = String(planId);
    if (!session.state.buildOptionsByPlan[String(planId)]) {
      const { adapter, config } = await this.clientFactory();
      session.state.buildOptionsByPlan = {
        ...session.state.buildOptionsByPlan,
        [String(planId)]: await adapter.listBuildsForPlan(config, planId)
      };
    }
    session.state.addSection.createForm.buildId = String(
      (session.state.buildOptionsByPlan[String(planId)] ?? [])[0]?.id ?? ""
    );
  }

  private async openRow(session: PanelSession, runId: number): Promise<void> {
    const row = findRow(session.state, runId);
    if (!row) {
      throw new KiwiError("NotFound", `Test Run ${runId} was not found.`);
    }
    await this.openCaseDocument(session.state.target);
  }

  private pushState(session: PanelSession): void {
    session.panel.webview.postMessage({ type: "state", state: cloneBoardState(session.state) });
  }

  private log(input: {
    level: "info" | "error";
    event: string;
    operation: string;
    entityId: string;
    virtualPath: string;
    outcome: "started" | "succeeded" | "failed";
    details?: string;
    message?: string;
  }) {
    void this.logger.log({
      level: input.level,
      event: input.event,
      source: "runtime",
      operation: input.operation,
      entityType: "caseExecutionBoard",
      entityId: input.entityId,
      virtualPath: input.virtualPath,
      outcome: input.outcome,
      ...(input.details ? { details: input.details } : {}),
      ...(input.message ? { message: input.message } : {})
    });
  }
}

function findRow(state: BoardState, runId: number): CaseExecutionBoardRow | undefined {
  for (const group of state.groups) {
    const row = group.rows.find((item) => item.runId === runId);
    if (row) {
      return row;
    }
  }
  return undefined;
}

function cloneBoardState(state: BoardState): BoardState {
  return {
    target: {
      plan: { ...state.target.plan },
      caseRef: { ...state.target.caseRef }
    },
    plans: state.plans.map((plan) => ({ ...plan })),
    buildOptionsByPlan: Object.fromEntries(
      Object.entries(state.buildOptionsByPlan).map(([planId, items]) => [planId, items.map((build) => ({ ...build }))])
    ),
    groups: state.groups.map((group) => ({
      planId: group.planId,
      planName: group.planName,
      rows: group.rows.map((row) => ({ ...row }))
    })),
    statuses: state.statuses.map((status) => ({ ...status })),
    message: state.message,
    isLoading: state.isLoading,
    addSection: {
      createForm: { ...state.addSection.createForm }
    }
  };
}

function panelTitle(target: CaseExecutionBoardTarget): string {
  return localize("Manage Test Case Executions: {0} - {1}", target.caseRef.id, target.caseRef.summary);
}

type Message =
  | { type: "reload" }
  | { type: "close" }
  | { type: "toggleCreateForm" }
  | { type: "changeCreatePlan"; planId: number }
  | { type: "addExistingRun" }
  | { type: "createRun"; planId: number; summary: string; buildId: number; manager: string }
  | { type: "saveRow"; runId: number; status: string; comment: string }
  | { type: "openRow"; runId: number };

function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && "type" in value;
}

function humanMessage(error: unknown): string {
  if (error instanceof KiwiError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
