import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { KiwiError } from "../domain/errors";
import { KiwiConfig } from "../types";
import { CASE_SEARCH_PAGE_SIZE, paginateCaseSearchItems } from "./buildCaseSearchQuickPickItems";
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
  selectedCaseIds: number[];
  visibleCount: number;
  isSearching: boolean;
  isBulkUpdating: boolean;
  message: string;
};

type WebviewState = {
  formState: CaseFilterFormState;
  options: CaseFilterOptions;
  results: CaseFilterResult[];
  visibleResults: CaseFilterResult[];
  visibleCount: number;
  totalCount: number;
  hasMore: boolean;
  isSearching: boolean;
  isBulkUpdating: boolean;
  selectedCaseIds: number[];
  selectedCount: number;
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
      "テストケースを探す",
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
      selectedCaseIds: [],
      visibleCount: CASE_SEARCH_PAGE_SIZE,
      isSearching: false,
      isBulkUpdating: false,
      message: "条件を入力して検索してください。"
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

  getHtmlForTest(): string | undefined {
    return this.session?.panel.webview.html;
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

  async toggleSelectedForTest(caseId: number, selected: boolean): Promise<WebviewState> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Case filter panel is not open.");
    }
    this.toggleSelected(this.session, caseId, selected);
    return toWebviewState(this.session);
  }

  async bulkUpdateStatusForTest(caseIds: number[], status: string): Promise<{ updated: number; failed: number }> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Case filter panel is not open.");
    }
    return this.bulkUpdateStatus(this.session, caseIds, status);
  }

  async bulkAddTagsForTest(caseIds: number[], tagsInput: string): Promise<{ updated: number; failed: number }> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Case filter panel is not open.");
    }
    return this.bulkUpdateTags(this.session, caseIds, tagsInput, "add");
  }

  async bulkRemoveTagsForTest(caseIds: number[], tagsInput: string): Promise<{ updated: number; failed: number }> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Case filter panel is not open.");
    }
    return this.bulkUpdateTags(this.session, caseIds, tagsInput, "remove");
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
          session.selectedCaseIds = [];
          session.visibleCount = CASE_SEARCH_PAGE_SIZE;
          session.message = "条件を入力して検索してください。";
          this.pushState(session);
          break;
        case "loadMore":
          session.visibleCount += CASE_SEARCH_PAGE_SIZE;
          session.message = buildResultMessage(session);
          this.pushState(session);
          break;
        case "toggleSelected":
          this.toggleSelected(session, message.caseId, message.selected);
          break;
        case "bulkUpdateStatus":
          await this.promptAndBulkUpdateStatus(session);
          break;
        case "bulkAddTags":
          await this.promptAndBulkUpdateTags(session, "add");
          break;
        case "bulkRemoveTags":
          await this.promptAndBulkUpdateTags(session, "remove");
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
          title: "Exploring cases..."
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
      session.selectedCaseIds = session.selectedCaseIds.filter((caseId) =>
        results.some((result) => result.caseRef.id === caseId)
      );
      session.visibleCount = CASE_SEARCH_PAGE_SIZE;
      session.message = buildResultMessage(session);
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
    session.selectedCaseIds = [];
    session.visibleCount = CASE_SEARCH_PAGE_SIZE;
    this.pushState(session);
  }

  private toggleSelected(session: PanelSession, caseId: number, selected: boolean): void {
    const next = new Set(session.selectedCaseIds);
    if (selected) {
      next.add(caseId);
    } else {
      next.delete(caseId);
    }
    session.selectedCaseIds = [...next].sort((left, right) => left - right);
    session.message = buildResultMessage(session);
    this.pushState(session);
  }

  private async promptAndBulkUpdateStatus(session: PanelSession): Promise<void> {
    const caseIds = selectedCaseIds(session);
    if (caseIds.length === 0) {
      session.message = "一括更新するテストケースを選択してください。";
      this.pushState(session);
      return;
    }
    const picked = await vscode.window.showQuickPick(
      session.options.statuses.map((status) => ({ label: status, status })),
      { placeHolder: "選択したテストケースへ適用する status を選択してください" }
    );
    if (!picked) {
      return;
    }
    const proceed =
      (await vscode.window.showWarningMessage(
        `${caseIds.length} 件のテストケースに status=${picked.status} を適用しますか？`,
        { modal: true },
        "適用"
      )) === "適用";
    if (!proceed) {
      return;
    }
    const result = await this.bulkUpdateStatus(session, caseIds, picked.status);
    session.message = `Bulk status update finished. updated=${result.updated}, failed=${result.failed}`;
    this.pushState(session);
  }

  private async bulkUpdateStatus(
    session: PanelSession,
    caseIds: number[],
    status: string
  ): Promise<{ updated: number; failed: number }> {
    const { adapter, config } = await this.clientFactory();
    let updated = 0;
    let failed = 0;
    session.isBulkUpdating = true;
    session.message = "一括 status 更新中...";
    this.pushState(session);
    try {
      for (const caseId of caseIds) {
        try {
          await adapter.updateCaseMetadata(config, caseId, { status });
          updated += 1;
        } catch {
          failed += 1;
        }
      }
      await this.refreshResults(session, adapter, config);
      return { updated, failed };
    } finally {
      session.isBulkUpdating = false;
      this.pushState(session);
    }
  }

  private async promptAndBulkUpdateTags(session: PanelSession, mode: "add" | "remove"): Promise<void> {
    const caseIds = selectedCaseIds(session);
    if (caseIds.length === 0) {
      session.message = "一括更新するテストケースを選択してください。";
      this.pushState(session);
      return;
    }
    const tagsInput = await vscode.window.showInputBox({
      prompt: mode === "add" ? "追加するタグを comma-separated で入力してください" : "削除するタグを comma-separated で入力してください",
      placeHolder: "smoke, regression"
    });
    if (tagsInput === undefined) {
      return;
    }
    const normalizedTags = normalizeTags(tagsInput);
    if (normalizedTags.length === 0) {
      session.message = "タグを入力してください。";
      this.pushState(session);
      return;
    }
    const actionLabel = mode === "add" ? "追加" : "削除";
    const proceed =
      (await vscode.window.showWarningMessage(
        `${caseIds.length} 件のテストケースに対してタグを${actionLabel}しますか？`,
        { modal: true },
        actionLabel
      )) === actionLabel;
    if (!proceed) {
      return;
    }
    const result = await this.bulkUpdateTags(session, caseIds, tagsInput, mode);
    session.message = `Bulk tag ${mode === "add" ? "add" : "remove"} finished. updated=${result.updated}, failed=${result.failed}`;
    this.pushState(session);
  }

  private async bulkUpdateTags(
    session: PanelSession,
    caseIds: number[],
    tagsInput: string,
    mode: "add" | "remove"
  ): Promise<{ updated: number; failed: number }> {
    const { adapter, config } = await this.clientFactory();
    const targetTags = normalizeTags(tagsInput);
    let updated = 0;
    let failed = 0;
    session.isBulkUpdating = true;
    session.message = mode === "add" ? "一括 tag 追加中..." : "一括 tag 削除中...";
    this.pushState(session);
    try {
      for (const caseId of caseIds) {
        try {
          const current = await adapter.getCase(config, caseId);
          const currentTags = current.tags.map((tag) => tag.trim());
          const nextTags =
            mode === "add"
              ? [...new Set([...currentTags, ...targetTags])].sort((left, right) => left.localeCompare(right))
              : currentTags
                  .filter((tag) => !targetTags.includes(tag.toLocaleLowerCase()))
                  .sort((left, right) => left.localeCompare(right));
          await adapter.updateCaseMetadata(config, caseId, { tags: nextTags });
          updated += 1;
        } catch {
          failed += 1;
        }
      }
      await this.refreshResults(session, adapter, config);
      return { updated, failed };
    } finally {
      session.isBulkUpdating = false;
      this.pushState(session);
    }
  }

  private async refreshResults(
    session: PanelSession,
    adapter: KiwiAdapter,
    config: KiwiConfig
  ): Promise<void> {
    const refreshed: CaseFilterResult[] = [];
    for (const result of session.results) {
      const caseData = await adapter.getCase(config, result.caseRef.id, result.plan.id);
      refreshed.push({
        ...result,
        caseRef: {
          id: caseData.id,
          summary: caseData.summary
        },
        status: caseData.status,
        priority: caseData.priority,
        tags: [...caseData.tags].sort((left, right) => left.localeCompare(right))
      });
    }
    session.results = refreshed;
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
  const page = visiblePage(session);
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
      tags: [...result.tags],
      textSnippet: result.textSnippet
    })),
    visibleResults: page.visibleItems.map((result) => ({
      plan: { ...result.plan },
      caseRef: { ...result.caseRef },
      status: result.status,
      priority: result.priority,
      tags: [...result.tags],
      textSnippet: result.textSnippet
    })),
    visibleCount: page.visibleCount,
    totalCount: session.results.length,
    hasMore: page.hasMore,
    isSearching: session.isSearching,
    isBulkUpdating: session.isBulkUpdating,
    selectedCaseIds: [...session.selectedCaseIds],
    selectedCount: session.selectedCaseIds.length,
    message: session.message
  };
}

function visiblePage(session: PanelSession) {
  return paginateCaseSearchItems(session.results, session.visibleCount);
}

function buildResultMessage(session: PanelSession): string {
  if (session.results.length === 0) {
    return "一致するテストケースはありません。";
  }
  const page = visiblePage(session);
  return `表示中 ${page.visibleCount} / 総件数 ${page.totalCount} / 選択 ${session.selectedCaseIds.length}`;
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
    <title>テストケースを探す</title>
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
      .actions, .bulk-actions {
        display: flex;
        gap: 8px;
        align-items: end;
      }
      .bulk-actions {
        margin: 0 0 12px;
        flex-wrap: wrap;
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
      h1 {
        margin: 0 0 16px;
        font-size: 26px;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <h1>テストケースを探す</h1>
    <form id="form">
      <label>Query
        <input id="query" type="text" placeholder="ID または summary" />
      </label>
      <label>Query Target
        <select id="queryTarget"></select>
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
    <div class="bulk-actions">
      <span id="selectionSummary">選択件数: 0</span>
      <button class="secondary" id="bulkStatus" type="button">status を一括変更</button>
      <button class="secondary" id="bulkAddTags" type="button">tag を追加</button>
      <button class="secondary" id="bulkRemoveTags" type="button">tag を削除</button>
    </div>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>ID</th>
          <th class="summary">Summary</th>
          <th>Plan</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Tags</th>
          <th>Snippet</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="results"></tbody>
    </table>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const form = document.getElementById('form');
      const query = document.getElementById('query');
      const queryTarget = document.getElementById('queryTarget');
      const planId = document.getElementById('planId');
      const status = document.getElementById('status');
      const priority = document.getElementById('priority');
      const tagsInput = document.getElementById('tagsInput');
      const searchButton = document.getElementById('search');
      const clearButton = document.getElementById('clear');
      const loadMoreButton = document.createElement('button');
      const closeButton = document.getElementById('close');
      const message = document.getElementById('message');
      const results = document.getElementById('results');
      const selectionSummary = document.getElementById('selectionSummary');
      const bulkStatusButton = document.getElementById('bulkStatus');
      const bulkAddTagsButton = document.getElementById('bulkAddTags');
      const bulkRemoveTagsButton = document.getElementById('bulkRemoveTags');
      let state = ${bootstrap};

      function option(select, value, text, selected) {
        const item = document.createElement('option');
        item.value = value;
        item.textContent = text;
        item.selected = selected;
        select.appendChild(item);
      }

      function renderSelects() {
        queryTarget.innerHTML = '';
        option(queryTarget, 'id-summary', 'ID / Summary', state.formState.queryTarget === 'id-summary');
        option(queryTarget, 'body', '本文全文', state.formState.queryTarget === 'body');
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
        for (const result of state.visibleResults) {
          const row = document.createElement('tr');
          const selectionCell = document.createElement('td');
          const selection = document.createElement('input');
          selection.type = 'checkbox';
          selection.checked = state.selectedCaseIds.includes(result.caseRef.id);
          selection.disabled = state.isSearching || state.isBulkUpdating;
          selection.addEventListener('change', () => {
            vscode.postMessage({ type: 'toggleSelected', caseId: result.caseRef.id, selected: selection.checked });
          });
          selectionCell.appendChild(selection);
          row.appendChild(selectionCell);
          const cells = [
            result.caseRef.id,
            result.caseRef.summary,
            result.plan.id + ' - ' + result.plan.name,
            result.status,
            result.priority,
            result.tags.join(', '),
            result.textSnippet || ''
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
        selectionSummary.textContent = '選択件数: ' + state.selectedCount;
        bulkStatusButton.disabled = state.selectedCount === 0 || state.isSearching || state.isBulkUpdating;
        bulkAddTagsButton.disabled = state.selectedCount === 0 || state.isSearching || state.isBulkUpdating;
        bulkRemoveTagsButton.disabled = state.selectedCount === 0 || state.isSearching || state.isBulkUpdating;
        renderResults();
        loadMoreButton.style.display = state.hasMore ? 'inline-block' : 'none';
      }

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        vscode.postMessage({
          type: 'search',
          formState: {
            query: query.value,
            queryTarget: queryTarget.value,
            planId: planId.value,
            status: status.value,
            priority: priority.value,
            tagsInput: tagsInput.value
          }
        });
      });
      clearButton.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
      bulkStatusButton.addEventListener('click', () => vscode.postMessage({ type: 'bulkUpdateStatus' }));
      bulkAddTagsButton.addEventListener('click', () => vscode.postMessage({ type: 'bulkAddTags' }));
      bulkRemoveTagsButton.addEventListener('click', () => vscode.postMessage({ type: 'bulkRemoveTags' }));
      loadMoreButton.className = 'secondary';
      loadMoreButton.id = 'loadMore';
      loadMoreButton.type = 'button';
      loadMoreButton.textContent = 'さらに表示';
      loadMoreButton.addEventListener('click', () => vscode.postMessage({ type: 'loadMore' }));
      clearButton.parentElement.insertBefore(loadMoreButton, closeButton);
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
  | { type: "loadMore" }
  | { type: "toggleSelected"; caseId: number; selected: boolean }
  | { type: "bulkUpdateStatus" }
  | { type: "bulkAddTags" }
  | { type: "bulkRemoveTags" }
  | { type: "reload" }
  | { type: "close" }
  | { type: "open"; caseId: number } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  if (type === "clear" || type === "loadMore" || type === "reload" || type === "close") {
    return true;
  }
  if (type === "bulkUpdateStatus" || type === "bulkAddTags" || type === "bulkRemoveTags") {
    return true;
  }
  if (type === "open") {
    return typeof (value as { caseId?: unknown }).caseId === "number";
  }
  if (type === "toggleSelected") {
    return (
      typeof (value as { caseId?: unknown }).caseId === "number" &&
      typeof (value as { selected?: unknown }).selected === "boolean"
    );
  }
  if (type === "search") {
    const formState = (value as { formState?: CaseFilterFormState }).formState;
    return Boolean(
      formState &&
        typeof formState.query === "string" &&
        (formState.queryTarget === "id-summary" || formState.queryTarget === "body") &&
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
    queryTarget: "id-summary",
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

function selectedCaseIds(session: PanelSession): number[] {
  return session.selectedCaseIds.filter((caseId) =>
    session.results.some((result) => result.caseRef.id === caseId)
  );
}

function normalizeTags(tagsInput: string): string[] {
  return [
    ...new Set(
      tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => tag.toLocaleLowerCase())
    )
  ].sort((left, right) => left.localeCompare(right));
}
