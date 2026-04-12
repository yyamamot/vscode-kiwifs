import * as vscode from "vscode";
import { JsonlLogger } from "../logging/jsonlLogger";
import { KiwiAdapter } from "../adapter/types";
import { KiwiError } from "../domain/errors";
import { diffExecutionResultPatch } from "../domain/executionResultForm";
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
    if (this.session) {
      this.session.panel.reveal(this.session.panel.viewColumn, false);
      await this.reload(this.session);
      return this.session.panel;
    }

    const seed = await this.loadSeedState();

    const panel = vscode.window.createWebviewPanel(
      "kiwiTestRunDashboard",
      "テスト実行ダッシュボード",
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
    panel.webview.html = renderWebviewHtml(panel.webview, session.state);
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
          ? "Test Run がありません。作成してください。"
          : "Test Run を作成するか、既存の Test Run を開いてください。",
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
      session.state.message = "開ける Test Run がありません。";
      this.pushState(session);
      return;
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "開く Test Run を選択してください",
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
    session.state.message = "テスト実行を読み込み中...";
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
        executions.length === 0 ? "この Test Run に実行結果はありません。" : `${executions.length} 件の実行結果を表示しています。`;
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
    session.state.message = "Test Run を作成中...";
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
    session.state.message = "Test Run を作成しました。";
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
      prompt: "追加する既存テストケース ID または summary を入力してください",
      placeHolder: "例: 501 / Login"
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
      session.state.message = "追加できるテストケースは見つかりませんでした。";
      this.pushState(session);
      return;
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "この Test Run に追加するテストケースを選択してください",
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
    session.state.message = "テストケースを Test Run に追加しました。";
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
      session.state.message = "一括更新する行を選択してください。";
      this.pushState(session);
      return;
    }
    const proceed =
      (await vscode.window.showWarningMessage(
        `選択した ${executionIds.length} 件の実行結果を ${status} に更新しますか？`,
        { modal: true },
        "更新"
      )) === "更新";
    if (!proceed) {
      return;
    }
    const result = await this.bulkUpdate(session, executionIds, status);
    session.state.message = `Bulk status update finished. updated=${result.updated}, failed=${result.failed}`;
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
        placeHolder: "選択行へ一括適用する status を選択してください",
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
    session.state.message = "実行結果を保存中...";
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
      session.state.message = Object.keys(patch).length === 0 ? "変更はありません。" : "実行結果を保存しました。";
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

function renderWebviewHtml(webview: vscode.Webview, state: DashboardState): string {
  const nonce = `${Date.now()}${Math.random().toString(16).slice(2)}`;
  const bootstrap = JSON.stringify(cloneState(state));
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>テスト実行ダッシュボード</title>
  <style>
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); padding: 20px; }
    .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .create-run { margin-bottom: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    select, input, textarea, button { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
    select, input, textarea { padding: 6px 8px; box-sizing: border-box; }
    button { padding: 6px 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid var(--vscode-panel-border); padding: 8px; vertical-align: top; }
    textarea { width: 100%; min-height: 56px; }
    .message { color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
    .current-run { color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
    .empty { padding: 16px 0; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h1>テスト実行ダッシュボード</h1>
    <div class="toolbar">
      <button id="toggleCreateRun">Test Run を作成</button>
      <button id="openExistingRun">既存の Test Run を開く</button>
      <button id="addCase">この Test Run にテストケースを追加</button>
      <button id="bulkStatus">選択行の status を一括更新</button>
      <button id="reload">再読み込み</button>
      <button id="close">閉じる</button>
    </div>
    <div class="create-run" id="createRunForm" style="display:none;">
      <input id="runSummary" placeholder="summary" />
      <select id="runPlan"></select>
      <select id="runBuild"></select>
      <input id="runManager" placeholder="manager" />
      <button id="createRun">作成</button>
    </div>
    <div class="message" id="message"></div>
    <div class="current-run" id="currentRun"></div>
    <div class="empty" id="emptyState" style="display:none;">Test Run を作成してください。</div>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>caseId</th>
        <th>summary</th>
        <th>status</th>
        <th>build</th>
        <th>comment</th>
        <th>開く</th>
        <th>保存</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state = ${bootstrap};
    const message = document.getElementById('message');
    const currentRun = document.getElementById('currentRun');
    const emptyState = document.getElementById('emptyState');
    const addCaseButton = document.getElementById('addCase');
    const bulkStatusButton = document.getElementById('bulkStatus');
    const rows = document.getElementById('rows');
    const createRunForm = document.getElementById('createRunForm');
    const runSummary = document.getElementById('runSummary');
    const runPlan = document.getElementById('runPlan');
    const runBuild = document.getElementById('runBuild');
    const runManager = document.getElementById('runManager');
    function render() {
      createRunForm.style.display = state.createForm.isVisible ? 'flex' : 'none';
      runSummary.value = state.createForm.summary || '';
      runPlan.innerHTML = '';
      for (const plan of state.plans) {
        const option = document.createElement('option');
        option.value = String(plan.id);
        option.textContent = plan.id + ' - ' + plan.name;
        if (String(plan.id) === state.createForm.planId) option.selected = true;
        runPlan.appendChild(option);
      }
      const buildOptions = state.buildOptionsByPlan[state.createForm.planId] || [];
      runBuild.innerHTML = '';
      for (const build of buildOptions) {
        const option = document.createElement('option');
        option.value = String(build.id);
        option.textContent = build.name;
        if (String(build.id) === state.createForm.buildId) option.selected = true;
        runBuild.appendChild(option);
      }
      if (buildOptions.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '(build がありません)';
        option.selected = true;
        runBuild.appendChild(option);
      }
      runBuild.value = state.createForm.buildId || runBuild.value || '';
      runManager.value = state.createForm.manager || '';
      rows.innerHTML = '';
      for (const row of state.rows) {
        const tr = document.createElement('tr');
        const statusOptions = state.statuses.map((status) => '<option value="' + status.name + '"' + (status.name === row.status ? ' selected' : '') + '>' + status.name + '</option>').join('');
        tr.innerHTML = '<td><input type="checkbox" data-role="select" data-execution="' + row.executionId + '"' + (row.selected ? ' checked' : '') + '></td>'
          + '<td>' + row.caseId + '</td>'
          + '<td>' + escapeHtml(row.caseSummary) + '</td>'
          + '<td><select data-role="status" data-execution="' + row.executionId + '">' + statusOptions + '</select></td>'
          + '<td>' + escapeHtml(row.build || '-') + '</td>'
          + '<td><textarea data-role="comment" data-execution="' + row.executionId + '">' + escapeHtml(row.comment || '') + '</textarea></td>'
          + '<td><button data-role="open" data-execution="' + row.executionId + '">開く</button></td>'
          + '<td><button data-role="save" data-execution="' + row.executionId + '"' + (row.isSaving ? ' disabled' : '') + '>保存</button></td>';
        rows.appendChild(tr);
      }
      message.textContent = state.message || '';
      const selectedRun = state.testRuns.find((run) => String(run.id) === state.selectedRunId);
      currentRun.textContent = selectedRun
        ? '現在の Test Run: TR' + selectedRun.id + ' ' + selectedRun.summary + (selectedRun.build ? ' / ' + selectedRun.build : '')
        : '現在の Test Run: 未選択';
      addCaseButton.disabled = !selectedRun;
      bulkStatusButton.disabled = !selectedRun;
      emptyState.style.display = !selectedRun && state.rows.length === 0 ? 'block' : 'none';
    }
    function escapeHtml(value) {
      return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;');
    }
    document.getElementById('openExistingRun').addEventListener('click', () => vscode.postMessage({ type: 'openExistingRun' }));
    document.getElementById('addCase').addEventListener('click', () => vscode.postMessage({ type: 'addCase' }));
    document.getElementById('bulkStatus').addEventListener('click', () => {
      vscode.postMessage({ type: 'bulkStatus' });
    });
    document.getElementById('toggleCreateRun').addEventListener('click', () => {
      state.createForm.isVisible = !state.createForm.isVisible;
      render();
    });
    runPlan.addEventListener('change', () => {
      state.createForm.planId = runPlan.value;
      const buildOptions = state.buildOptionsByPlan[state.createForm.planId] || [];
      state.createForm.buildId = String(buildOptions[0]?.id || '');
      render();
    });
    document.getElementById('createRun').addEventListener('click', () => {
      vscode.postMessage({
        type: 'createRun',
        summary: runSummary.value,
        planId: Number(runPlan.value),
        buildId: Number(runBuild.value),
        manager: runManager.value
      });
    });
    document.getElementById('reload').addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    document.getElementById('close').addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    rows.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const executionId = Number(target.dataset.execution);
      if (!Number.isFinite(executionId)) return;
      if (target.dataset.role === 'open') {
        vscode.postMessage({ type: 'openRow', executionId });
      }
      if (target.dataset.role === 'save') {
        const status = rows.querySelector('[data-role="status"][data-execution="' + executionId + '"]').value;
        const comment = rows.querySelector('[data-role="comment"][data-execution="' + executionId + '"]').value;
        vscode.postMessage({ type: 'saveRow', executionId, status, comment });
      }
    });
    rows.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const executionId = Number(target.dataset.execution);
      if (!Number.isFinite(executionId)) return;
      if (target.dataset.role === 'select') {
        vscode.postMessage({ type: 'toggleSelected', executionId, selected: target.checked });
      }
    });
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'state') {
        state = event.data.state;
        render();
      }
    });
    render();
  </script>
</body>
</html>`;
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
