import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { KiwiError } from "../domain/errors";
import { KiwiConfig } from "../types";
import {
  CaseFilterFormState,
  CaseFilterOptions,
  CaseFilterResult,
  filterCasesWithMetadata
} from "./caseFilter";

type ClientFactory = () => Promise<{
  adapter: KiwiAdapter;
  config: KiwiConfig;
}>;

type PanelSession = {
  panel: vscode.WebviewPanel;
  formState: CaseFilterFormState;
  options: CaseFilterOptions;
  results: CaseFilterResult[];
  isSearching: boolean;
  message: string;
};

type WebviewState = {
  formState: CaseFilterFormState;
  options: CaseFilterOptions;
  results: CaseFilterResult[];
  isSearching: boolean;
  message: string;
};

export class CaseFilterController implements vscode.Disposable {
  private session: PanelSession | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly openResult: (result: CaseFilterResult) => Promise<vscode.Uri>
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
      "kiwiCaseFilter",
      "テストケースをフィルタ",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    const session: PanelSession = {
      panel,
      formState: emptyFormState(),
      options,
      results: [],
      isSearching: false,
      message: "条件を入力して検索してください。",
    };
    this.session = session;

    panel.webview.html = renderWebviewHtml(panel.webview, session);
    const messageDisposable = panel.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(session, message);
    });
    const disposeDisposable = panel.onDidDispose(() => {
      this.session = undefined;
      messageDisposable.dispose();
      disposeDisposable.dispose();
    });
    this.disposables.push(messageDisposable, disposeDisposable);
    return panel;
  }

  getStateForTest(): WebviewState | undefined {
    if (!this.session) {
      return undefined;
    }
    return toWebviewState(this.session);
  }

  async searchForTest(formState: CaseFilterFormState): Promise<CaseFilterResult[]> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Case filter panel is not open.");
    }
    return this.search(this.session, formState);
  }

  async openResultForTest(caseId: number): Promise<string | undefined> {
    const result = this.session?.results.find((item) => item.caseRef.id === caseId);
    if (!result) {
      return undefined;
    }
    const uri = await this.openResult(result);
    return uri.toString();
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
          session.formState = emptyFormState();
          session.results = [];
          session.message = "条件を入力して検索してください。";
          this.pushState(session);
          break;
        case "reload":
          await this.reload(session);
          break;
        case "open":
          await this.openByCaseId(session, message.caseId);
          break;
        case "close":
          session.panel.dispose();
          break;
        default:
          break;
      }
    } catch (error) {
      session.message = humanMessage(error);
      session.panel.webview.postMessage({
        type: "error",
        message: session.message
      });
      void vscode.window.showErrorMessage(session.message);
      this.pushState(session);
    }
  }

  private async search(
    session: PanelSession,
    formState: CaseFilterFormState
  ): Promise<CaseFilterResult[]> {
    session.formState = { ...formState };
    session.isSearching = true;
    session.message = "検索中...";
    this.pushState(session);
    try {
      const results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "テストケースをフィルタ中..."
        },
        async () => {
          const { adapter, config } = await this.clientFactory();
          return filterCasesWithMetadata({
            adapter,
            config,
            formState,
            options: session.options
          });
        }
      );
      session.results = results;
      session.message =
        results.length === 0
          ? "一致するテストケースはありません。"
          : `${results.length} 件のテストケースが見つかりました。`;
      return results;
    } finally {
      session.isSearching = false;
      if (this.session === session) {
        this.pushState(session);
      }
    }
  }

  private async reload(session: PanelSession): Promise<void> {
    session.options = await this.loadOptions();
    session.message = "条件を入力して検索してください。";
    this.pushState(session);
  }

  private async openByCaseId(session: PanelSession, caseId: number): Promise<void> {
    const result = session.results.find((item) => item.caseRef.id === caseId);
    if (!result) {
      throw new KiwiError("NotFound", `Case ${caseId} was not found in filter results.`);
    }
    await this.openResult(result);
  }

  private async loadOptions(): Promise<CaseFilterOptions> {
    const { adapter, config } = await this.clientFactory();
    const [plans, statuses, priorities] = await Promise.all([
      adapter.listPlans(config),
      adapter.listCaseStatuses(config),
      adapter.listPriorities(config)
    ]);
    return {
      plans: [...plans].sort((left, right) => left.id - right.id),
      statuses,
      priorities
    };
  }

  private pushState(session: PanelSession): void {
    session.panel.webview.postMessage({
      type: "state",
      ...toWebviewState(session)
    });
  }
}

function toWebviewState(session: PanelSession): WebviewState {
  return {
    formState: { ...session.formState },
    options: {
      plans: session.options.plans.map((plan) => ({ ...plan })),
      statuses: [...session.options.statuses],
      priorities: [...session.options.priorities]
    },
    results: session.results.map((result) => ({
      plan: { ...result.plan },
      caseRef: { ...result.caseRef },
      status: result.status,
      priority: result.priority,
      tags: [...result.tags]
    })),
    isSearching: session.isSearching,
    message: session.message
  };
}

function renderWebviewHtml(webview: vscode.Webview, session: PanelSession): string {
  const nonce = createNonce();
  const bootstrap = JSON.stringify(toWebviewState(session));

  return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>テストケースをフィルタ</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        margin: 0;
        padding: 20px;
      }
      form {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
        margin-bottom: 18px;
      }
      label {
        display: grid;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
      }
      input, select {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, transparent);
      }
      .actions {
        display: flex;
        gap: 8px;
        align-items: end;
      }
      button {
        padding: 8px 14px;
        border: 1px solid var(--vscode-button-border, transparent);
        cursor: pointer;
      }
      button.primary {
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
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
    </style>
  </head>
  <body>
    <form id="form">
      <label>Query
        <input id="query" type="text" placeholder="ID または summary" />
      </label>
      <label>Plan
        <select id="planId"></select>
      </label>
      <label>Status
        <select id="status"></select>
      </label>
      <label>Priority
        <select id="priority"></select>
      </label>
      <label>Tags
        <input id="tagsInput" type="text" placeholder="smoke, regression" />
      </label>
      <div class="actions">
        <button class="primary" id="search" type="submit">検索</button>
        <button class="secondary" id="clear" type="button">クリア</button>
        <button class="secondary" id="close" type="button">閉じる</button>
      </div>
    </form>
    <p class="message" id="message"></p>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th class="summary">Summary</th>
          <th>Plan</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Tags</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="results"></tbody>
    </table>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const form = document.getElementById('form');
      const query = document.getElementById('query');
      const planId = document.getElementById('planId');
      const status = document.getElementById('status');
      const priority = document.getElementById('priority');
      const tagsInput = document.getElementById('tagsInput');
      const searchButton = document.getElementById('search');
      const clearButton = document.getElementById('clear');
      const closeButton = document.getElementById('close');
      const message = document.getElementById('message');
      const results = document.getElementById('results');
      let state = ${bootstrap};

      function option(select, value, text, selected) {
        const item = document.createElement('option');
        item.value = value;
        item.textContent = text;
        item.selected = selected;
        select.appendChild(item);
      }

      function renderSelects() {
        planId.innerHTML = '';
        option(planId, '', 'All Plans', state.formState.planId === '');
        for (const plan of state.options.plans) {
          option(planId, String(plan.id), plan.id + ' - ' + plan.name, state.formState.planId === String(plan.id));
        }
        status.innerHTML = '';
        option(status, '', 'Any', state.formState.status === '');
        for (const value of state.options.statuses) {
          option(status, value, value, state.formState.status === value);
        }
        priority.innerHTML = '';
        option(priority, '', 'Any', state.formState.priority === '');
        for (const value of state.options.priorities) {
          option(priority, value, value, state.formState.priority === value);
        }
      }

      function renderResults() {
        results.innerHTML = '';
        for (const result of state.results) {
          const row = document.createElement('tr');
          const cells = [
            result.caseRef.id,
            result.caseRef.summary,
            result.plan.id + ' - ' + result.plan.name,
            result.status,
            result.priority,
            result.tags.join(', ')
          ];
          for (const cellValue of cells) {
            const cell = document.createElement('td');
            cell.textContent = String(cellValue);
            row.appendChild(cell);
          }
          const actionCell = document.createElement('td');
          const open = document.createElement('button');
          open.className = 'link';
          open.type = 'button';
          open.textContent = '開く';
          open.addEventListener('click', () => {
            vscode.postMessage({ type: 'open', caseId: result.caseRef.id });
          });
          actionCell.appendChild(open);
          row.appendChild(actionCell);
          results.appendChild(row);
        }
      }

      function render() {
        query.value = state.formState.query;
        tagsInput.value = state.formState.tagsInput;
        renderSelects();
        message.textContent = state.message;
        searchButton.disabled = state.isSearching;
        clearButton.disabled = state.isSearching;
        renderResults();
      }

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        vscode.postMessage({
          type: 'search',
          formState: {
            query: query.value,
            planId: planId.value,
            status: status.value,
            priority: priority.value,
            tagsInput: tagsInput.value
          }
        });
      });
      clearButton.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
      closeButton.addEventListener('click', () => vscode.postMessage({ type: 'close' }));
      window.addEventListener('message', (event) => {
        const incoming = event.data;
        if (incoming.type === 'state') {
          state = incoming;
          render();
        } else if (incoming.type === 'error') {
          message.textContent = incoming.message;
        }
      });
      render();
    </script>
  </body>
</html>`;
}

function isMessage(
  value: unknown
): value is
  | { type: "search"; formState: CaseFilterFormState }
  | { type: "clear" }
  | { type: "reload" }
  | { type: "close" }
  | { type: "open"; caseId: number } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  if (type === "clear" || type === "reload" || type === "close") {
    return true;
  }
  if (type === "open") {
    return typeof (value as { caseId?: unknown }).caseId === "number";
  }
  if (type === "search") {
    const formState = (value as { formState?: CaseFilterFormState }).formState;
    return Boolean(
      formState &&
        typeof formState.query === "string" &&
        typeof formState.planId === "string" &&
        typeof formState.status === "string" &&
        typeof formState.priority === "string" &&
        typeof formState.tagsInput === "string"
    );
  }
  return false;
}

function emptyFormState(): CaseFilterFormState {
  return {
    query: "",
    planId: "",
    status: "",
    priority: "",
    tagsInput: ""
  };
}

function humanMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function createNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
