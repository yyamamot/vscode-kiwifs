import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { KiwiError } from "../domain/errors";
import {
  diffExecutionResultPatch,
  ExecutionResultFormState,
  toExecutionResultFormState
} from "../domain/executionResultForm";
import { KiwiCaseExecution, KiwiConfig, KiwiExecutionStatus, KiwiExecutionUpdatePatch } from "../types";

type ClientFactory = () => Promise<{
  adapter: KiwiAdapter;
  config: KiwiConfig;
}>;

export type ExecutionResultTarget = {
  plan: { id: number; name: string };
  caseRef: { id: number; summary: string };
  execution: KiwiCaseExecution;
};

export type ExecutionResultSaveResult = {
  executionId: number;
  caseId: number;
  runId: number;
  updatedExecution: KiwiCaseExecution;
  changedFields: Array<keyof KiwiExecutionUpdatePatch>;
};

type PanelSession = {
  target: ExecutionResultTarget;
  panel: vscode.WebviewPanel;
  sourceExecution: KiwiCaseExecution;
  formState: ExecutionResultFormState;
  statuses: KiwiExecutionStatus[];
  isSaving: boolean;
  message: string;
};

type WebviewState = {
  target: ExecutionResultTarget;
  formState: ExecutionResultFormState;
  statuses: KiwiExecutionStatus[];
  isSaving: boolean;
  message: string;
};

export class ExecutionResultController implements vscode.Disposable {
  private readonly sessions = new Map<string, PanelSession>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly onSaved: (result: ExecutionResultSaveResult) => Promise<void>
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

  async open(target: ExecutionResultTarget): Promise<vscode.WebviewPanel> {
    const key = sessionKey(target.execution.id);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn, false);
      await this.reload(existing);
      return existing.panel;
    }

    const { statuses, execution } = await this.loadExecution(
      target.execution.id,
      target.execution.caseId
    );
    const nextTarget = { ...target, execution };
    const panel = vscode.window.createWebviewPanel(
      "kiwiExecutionResult",
      panelTitle(nextTarget),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    const session: PanelSession = {
      target: nextTarget,
      panel,
      sourceExecution: execution,
      formState: toExecutionResultFormState(execution),
      statuses,
      isSaving: false,
      message: "実行結果を入力してください。"
    };
    this.sessions.set(key, session);
    panel.webview.html = renderWebviewHtml(panel.webview, session);

    const messageDisposable = panel.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(session, message);
    });
    const disposeDisposable = panel.onDidDispose(() => {
      this.sessions.delete(key);
      messageDisposable.dispose();
      disposeDisposable.dispose();
    });
    this.disposables.push(messageDisposable, disposeDisposable);
    return panel;
  }

  getStateForTest(executionId: number): WebviewState | undefined {
    const session = this.sessions.get(sessionKey(executionId));
    return session ? toWebviewState(session) : undefined;
  }

  async submitForTest(
    executionId: number,
    formState: ExecutionResultFormState
  ): Promise<ExecutionResultSaveResult> {
    const session = this.sessions.get(sessionKey(executionId));
    if (!session) {
      throw new KiwiError("ValidationFailed", `Execution result editor for ${executionId} is not open.`);
    }
    return this.save(session, formState);
  }

  private async handleMessage(session: PanelSession, message: unknown): Promise<void> {
    if (!isMessage(message)) {
      return;
    }

    try {
      switch (message.type) {
        case "save":
          await this.save(session, message.formState);
          break;
        case "reload":
          await this.reload(session);
          break;
        case "close":
          session.panel.dispose();
          break;
        default:
          break;
      }
    } catch (error) {
      session.message = humanMessage(error);
      session.panel.webview.postMessage({ type: "error", message: session.message });
      void vscode.window.showErrorMessage(session.message);
      this.pushState(session);
    }
  }

  private async save(
    session: PanelSession,
    formState: ExecutionResultFormState
  ): Promise<ExecutionResultSaveResult> {
    const patch = diffExecutionResultPatch(session.sourceExecution, formState, session.statuses);
    session.formState = { ...formState };
    session.isSaving = true;
    session.message = "保存中...";
    this.pushState(session);
    try {
      const { adapter, config } = await this.clientFactory();
      const updatedExecution =
        Object.keys(patch).length === 0
          ? session.sourceExecution
          : await adapter.updateExecution(config, session.sourceExecution.id, patch);
      const changedFields = Object.keys(patch) as ExecutionResultSaveResult["changedFields"];
      session.sourceExecution = updatedExecution;
      session.target = { ...session.target, execution: updatedExecution };
      session.formState = toExecutionResultFormState(updatedExecution);
      session.message = changedFields.length === 0 ? "変更はありません。" : "実行結果を保存しました。";
      const result: ExecutionResultSaveResult = {
        executionId: updatedExecution.id,
        caseId: updatedExecution.caseId,
        runId: updatedExecution.runId,
        updatedExecution,
        changedFields
      };
      await this.onSaved(result);
      return result;
    } finally {
      session.isSaving = false;
      this.pushState(session);
    }
  }

  private async reload(session: PanelSession): Promise<void> {
    const { statuses, execution } = await this.loadExecution(
      session.sourceExecution.id,
      session.sourceExecution.caseId
    );
    session.statuses = statuses;
    session.sourceExecution = execution;
    session.target = { ...session.target, execution };
    session.formState = toExecutionResultFormState(execution);
    session.message = "再読み込みしました。";
    this.pushState(session);
  }

  private async loadExecution(
    executionId: number,
    caseId: number
  ): Promise<{ statuses: KiwiExecutionStatus[]; execution: KiwiCaseExecution }> {
    const { adapter, config } = await this.clientFactory();
    const [statuses, executions] = await Promise.all([
      adapter.listExecutionStatuses(config),
      adapter.listCaseExecutions(config, caseId)
    ]);
    const execution = executions.find((item) => item.id === executionId);
    if (!execution) {
      throw new KiwiError("NotFound", `Execution ${executionId} was not found.`);
    }
    return { statuses, execution };
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
    target: {
      plan: { ...session.target.plan },
      caseRef: { ...session.target.caseRef },
      execution: { ...session.target.execution }
    },
    formState: { ...session.formState },
    statuses: session.statuses.map((status) => ({ ...status })),
    isSaving: session.isSaving,
    message: session.message
  };
}

function renderWebviewHtml(webview: vscode.Webview, session: PanelSession): string {
  const nonce = `${Date.now()}${Math.random().toString(16).slice(2)}`;
  const bootstrap = JSON.stringify(toWebviewState(session));
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(panelTitle(session.target))}</title>
  <style>
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); padding: 20px; }
    label { display: block; margin-top: 14px; font-weight: 600; }
    select, textarea { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; }
    textarea { min-height: 120px; }
    button { margin-top: 18px; margin-right: 8px; }
    .meta { color: var(--vscode-descriptionForeground); line-height: 1.6; }
    .message { margin-top: 12px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h1>テストケースの実行結果を更新</h1>
  <div class="meta" id="meta"></div>
  <label for="status">Status</label>
  <select id="status"></select>
  <label for="comment">Comment</label>
  <textarea id="comment" placeholder="任意のコメント"></textarea>
  <div>
    <button id="save">保存</button>
    <button id="reload">再読み込み</button>
    <button id="close">キャンセル</button>
  </div>
  <div class="message" id="message"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state = ${bootstrap};
    const status = document.getElementById('status');
    const comment = document.getElementById('comment');
    const save = document.getElementById('save');
    const message = document.getElementById('message');
    const meta = document.getElementById('meta');
    function render() {
      meta.textContent = 'Test Run ' + state.target.execution.runId + ' - ' + state.target.execution.runSummary + ' / build: ' + (state.target.execution.build || '-');
      status.innerHTML = '';
      for (const option of state.statuses) {
        const item = document.createElement('option');
        item.value = option.name;
        item.textContent = option.name;
        if (option.name === state.formState.status) item.selected = true;
        status.appendChild(item);
      }
      comment.value = state.formState.comment || '';
      save.disabled = state.isSaving;
      message.textContent = state.message || '';
    }
    save.addEventListener('click', () => vscode.postMessage({ type: 'save', formState: { status: status.value, comment: comment.value } }));
    document.getElementById('reload').addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    document.getElementById('close').addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'state') {
        state = event.data;
        render();
      }
    });
    render();
  </script>
</body>
</html>`;
}

function isMessage(value: unknown): value is
  | { type: "save"; formState: ExecutionResultFormState }
  | { type: "reload" }
  | { type: "close" } {
  return Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string");
}

function sessionKey(executionId: number): string {
  return String(executionId);
}

function panelTitle(target: ExecutionResultTarget): string {
  return `テストケースの実行結果を更新: ${target.caseRef.id} - ${target.caseRef.summary}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function humanMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
