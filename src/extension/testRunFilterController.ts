import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { KiwiError } from "../domain/errors";
import { KiwiConfig, KiwiPlan, KiwiTestRun } from "../types";

type ClientFactory = () => Promise<{
  adapter: KiwiAdapter;
  config: KiwiConfig;
}>;

type TestRunFilterFormState = {
  query: string;
  planId: string;
  build: string;
};

type TestRunFilterResult = KiwiTestRun & {
  planName: string;
};

type TestRunFilterOptions = {
  plans: Array<{ value: string; label: string }>;
  buildOptionsByPlan: Record<string, string[]>;
};

type PanelSession = {
  panel: vscode.WebviewPanel;
  formState: TestRunFilterFormState;
  options: TestRunFilterOptions;
  results: TestRunFilterResult[];
  isSearching: boolean;
  message: string;
};

type WebviewState = {
  formState: TestRunFilterFormState;
  options: TestRunFilterOptions;
  results: TestRunFilterResult[];
  isSearching: boolean;
  message: string;
};

export class TestRunFilterController implements vscode.Disposable {
  private session: PanelSession | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly openRun: (runId: number) => Promise<void>
  ) {}

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.session?.panel.dispose();
    this.session = undefined;
  }

  async open(): Promise<vscode.WebviewPanel> {
    if (this.session) {
      this.session.panel.reveal(this.session.panel.viewColumn, false);
      await this.reload(this.session);
      return this.session.panel;
    }

    const options = await this.loadOptions();
    const panel = vscode.window.createWebviewPanel(
      "kiwiTestRunFilter",
      "テスト実行を探す",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    const session: PanelSession = {
      panel,
      formState: {
        query: "",
        planId: "",
        build: ""
      },
      options,
      results: [],
      isSearching: false,
      message: "条件を入力して検索してください。"
    };
    this.session = session;
    panel.webview.html = renderWebviewHtml(panel.webview);
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

  getStateForTest(): WebviewState | undefined {
    return this.session ? toWebviewState(this.session) : undefined;
  }

  getHtmlForTest(): string | undefined {
    return this.session?.panel.webview.html;
  }

  async searchForTest(formState: TestRunFilterFormState): Promise<TestRunFilterResult[]> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Test Run filter panel is not open.");
    }
    return this.search(this.session, formState);
  }

  async openResultForTest(runId: number): Promise<number | undefined> {
    const run = this.session?.results.find((item) => item.id === runId);
    if (!run) {
      return undefined;
    }
    await this.openRun(run.id);
    return run.id;
  }

  private async handleMessage(session: PanelSession, message: unknown): Promise<void> {
    if (!isMessage(message)) {
      return;
    }

    try {
      switch (message.type) {
        case "search":
          await this.search(session, message.formState);
          break;
        case "clear":
          session.formState = { query: "", planId: "", build: "" };
          session.results = [];
          session.message = "条件を入力して検索してください。";
          this.pushState(session);
          break;
        case "reload":
          await this.reload(session);
          break;
        case "open":
          await this.openResult(session, message.runId);
          break;
        case "close":
          session.panel.dispose();
          break;
        default:
          break;
      }
    } catch (error) {
      session.message = humanMessage(error);
      void vscode.window.showErrorMessage(session.message);
      this.pushState(session);
    }
  }

  private async reload(session: PanelSession): Promise<void> {
    session.options = await this.loadOptions();
    if (session.formState.planId && !session.options.plans.some((plan) => plan.value === session.formState.planId)) {
      session.formState.planId = "";
      session.formState.build = "";
    }
    if (
      session.formState.build &&
      !resolveBuildOptions(session.options, session.formState.planId).includes(session.formState.build)
    ) {
      session.formState.build = "";
    }
    this.pushState(session);
  }

  private async search(
    session: PanelSession,
    formState: TestRunFilterFormState
  ): Promise<TestRunFilterResult[]> {
    session.formState = { ...formState };
    if (
      !session.formState.query.trim() &&
      !session.formState.planId &&
      !session.formState.build
    ) {
      session.results = [];
      session.message = "条件を入力して検索してください。";
      this.pushState(session);
      return [];
    }

    session.isSearching = true;
    session.message = "テスト実行を検索中...";
    this.pushState(session);
    try {
      const { adapter, config } = await this.clientFactory();
      const results = await adapter.searchTestRuns(config, {
        query: session.formState.query,
        planId: parseOptionalNumber(session.formState.planId),
        build: session.formState.build || undefined
      });
      session.results = attachPlanNames(results, session.options.plans);
      session.message =
        session.results.length === 0
          ? "一致する Test Run はありません。"
          : `${session.results.length} 件の Test Run を表示しています。`;
      this.pushState(session);
      return session.results;
    } finally {
      session.isSearching = false;
      this.pushState(session);
    }
  }

  private async openResult(session: PanelSession, runId: number): Promise<void> {
    await this.openRun(runId);
    session.message = `Test Run ${runId} をダッシュボードで開きました。`;
    this.pushState(session);
  }

  private async loadOptions(): Promise<TestRunFilterOptions> {
    const { adapter, config } = await this.clientFactory();
    const [plans, runs] = await Promise.all([adapter.listPlans(config), adapter.listTestRuns(config)]);
    return {
      plans: [
        { value: "", label: "All Plans" },
        ...plans
          .sort((left, right) => left.id - right.id)
          .map((plan) => ({ value: String(plan.id), label: `${plan.id} - ${plan.name}` }))
      ],
      buildOptionsByPlan: buildOptionsByPlan(plans, runs)
    };
  }

  private pushState(session: PanelSession): void {
    void session.panel.webview.postMessage({
      type: "state",
      state: toWebviewState(session)
    });
  }
}

function toWebviewState(session: PanelSession): WebviewState {
  return {
    formState: { ...session.formState },
    options: {
      plans: session.options.plans.map((plan) => ({ ...plan })),
      buildOptionsByPlan: Object.fromEntries(
        Object.entries(session.options.buildOptionsByPlan).map(([planId, builds]) => [planId, [...builds]])
      )
    },
    results: session.results.map((result) => ({ ...result })),
    isSearching: session.isSearching,
    message: session.message
  };
}

function buildOptionsByPlan(plans: KiwiPlan[], runs: KiwiTestRun[]): Record<string, string[]> {
  const byPlan: Record<string, string[]> = { "": [] };
  const allBuilds = [...new Set(runs.map((run) => run.build).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
  byPlan[""] = allBuilds;
  for (const plan of plans) {
    byPlan[String(plan.id)] = [
      ...new Set(runs.filter((run) => run.planId === plan.id).map((run) => run.build).filter(Boolean))
    ].sort((left, right) => left.localeCompare(right));
  }
  return byPlan;
}

function resolveBuildOptions(options: TestRunFilterOptions, planId: string): string[] {
  return options.buildOptionsByPlan[planId] ?? options.buildOptionsByPlan[""] ?? [];
}

function attachPlanNames(
  runs: KiwiTestRun[],
  plans: Array<{ value: string; label: string }>
): TestRunFilterResult[] {
  return runs.map((run) => ({
    ...run,
    planName:
      run.planName ??
      plans.find((plan) => plan.value === String(run.planId))?.label.replace(/^\d+\s*-\s*/, "") ??
      ""
  }));
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function humanMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMessage(
  value: unknown
): value is
  | { type: "search"; formState: TestRunFilterFormState }
  | { type: "clear" | "reload" | "close" }
  | { type: "open"; runId: number } {
  if (!value || typeof value !== "object") {
    return false;
  }
  return typeof (value as { type?: unknown }).type === "string";
}

function renderWebviewHtml(webview: vscode.Webview): string {
  const nonce = String(Date.now());
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>テスト実行を探す</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      padding: 16px;
    }
    form {
      display: grid;
      gap: 12px;
      margin-bottom: 12px;
    }
    label {
      display: grid;
      gap: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    input, select, button {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      color: inherit;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
    }
    button {
      width: auto;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 0;
    }
    button.secondary {
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    }
    button.link {
      color: var(--vscode-textLink-foreground);
      background: transparent;
      border: 0;
      padding: 0;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .message {
      color: var(--vscode-descriptionForeground);
      margin: 0 0 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      font-weight: 600;
    }
    .summary {
      min-width: 220px;
    }
    h1 {
      margin: 0 0 16px;
      font-size: 26px;
      font-weight: 600;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      padding: 8px 0;
    }
  </style>
</head>
<body>
  <h1>テスト実行を探す</h1>
  <form id="form">
    <label for="query">Query
      <input id="query" type="text" placeholder="例: 300 / Regression run" />
    </label>
    <label for="plan">Plan
      <select id="plan"></select>
    </label>
    <label for="build">Build
      <select id="build"></select>
    </label>
    <div class="actions">
      <button class="primary" id="search" type="submit">検索</button>
      <button class="secondary" id="clear" type="button">クリア</button>
      <button class="secondary" id="reload" type="button">再読み込み</button>
      <button class="secondary" id="close" type="button">閉じる</button>
    </div>
  </form>
  <div class="message" id="message"></div>
  <div id="results"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('form');
    const query = document.getElementById('query');
    const plan = document.getElementById('plan');
    const build = document.getElementById('build');
    const message = document.getElementById('message');
    const results = document.getElementById('results');
    const searchButton = document.getElementById('search');
    const clearButton = document.getElementById('clear');
    const reloadButton = document.getElementById('reload');
    const closeButton = document.getElementById('close');

    function postSearch() {
      vscode.postMessage({
        type: 'search',
        formState: {
          query: query.value,
          planId: plan.value,
          build: build.value
        }
      });
    }

    function renderBuildOptions(state) {
      const builds = state.options.buildOptionsByPlan[plan.value] ?? state.options.buildOptionsByPlan[''] ?? [];
      build.innerHTML = ['<option value="">All Builds</option>']
        .concat(builds.map((item) => '<option value="' + item + '">' + item + '</option>'))
        .join('');
      if (state.formState.build && builds.includes(state.formState.build)) {
        build.value = state.formState.build;
      } else {
        build.value = '';
      }
    }

    function renderResults(state) {
      if (state.results.length === 0) {
        if (state.message === '条件を入力して検索してください。') {
          results.innerHTML = '';
          return;
        }
        results.innerHTML = '<div class="empty">一致する Test Run はありません。</div>';
        return;
      }
      results.innerHTML = '<table><thead><tr><th>runId</th><th class="summary">summary</th><th>plan</th><th>build</th><th>manager</th><th></th></tr></thead><tbody>' +
        state.results.map((run) => '<tr>' +
          '<td>TR' + run.id + '</td>' +
          '<td>' + escapeHtml(run.summary) + '</td>' +
          '<td>' + escapeHtml(run.planName || '-') + '</td>' +
          '<td>' + escapeHtml(run.build || '-') + '</td>' +
          '<td>' + escapeHtml(run.manager || '-') + '</td>' +
          '<td><button class="link" type="button" data-run-id="' + run.id + '">開く</button></td>' +
        '</tr>').join('') +
        '</tbody></table>';
      results.querySelectorAll('button[data-run-id]').forEach((button) => {
        button.addEventListener('click', () => {
          vscode.postMessage({ type: 'open', runId: Number(button.dataset.runId) });
        });
      });
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    }

    function render(state) {
      query.value = state.formState.query;
      plan.innerHTML = state.options.plans.map((item) => '<option value="' + item.value + '">' + item.label + '</option>').join('');
      plan.value = state.formState.planId;
      renderBuildOptions(state);
      message.textContent = state.message;
      searchButton.disabled = state.isSearching;
      clearButton.disabled = state.isSearching;
      renderResults(state);
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      postSearch();
    });
    clearButton.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
    reloadButton.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    closeButton.addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    plan.addEventListener('change', () => renderBuildOptions(window.__state));

    window.addEventListener('message', (event) => {
      const state = event.data?.state;
      if (!state) {
        return;
      }
      window.__state = state;
      render(state);
    });
  </script>
</body>
</html>`;
}
