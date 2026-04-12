import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { KiwiCase, KiwiCaseCreatePayload, KiwiCaseMetadataPatch, KiwiConfig } from "../types";
import {
  CaseMetadataFormState,
  DEFAULT_CASE_BODY_TEMPLATE,
  diffCaseMetadataPatch,
  toCaseCreatePayload,
  toCaseMetadataFormState,
  toEditableCaseMetadata
} from "../domain/caseMetadataDocument";
import { KiwiError } from "../domain/errors";

export type MetadataEditorMode = "edit" | "create" | "duplicate";

type MetadataEditorPlan = { id: number; name: string };
type MetadataEditorCaseRef = { id: number; summary: string };

export type MetadataEditorTarget =
  | {
      mode: "edit" | "duplicate";
      plan: MetadataEditorPlan;
      caseRef: MetadataEditorCaseRef;
    }
  | {
      mode: "create";
      plan: MetadataEditorPlan;
    };

export interface MetadataEditorOptions {
  statuses: string[];
  priorities: string[];
}

export type MetadataEditorSaveResult =
  | {
      kind: "updated";
      planId: number;
      planName: string;
      caseId: number;
      oldSummary: string;
      updatedCase: KiwiCase;
      changedFields: Array<keyof KiwiCaseMetadataPatch>;
    }
  | {
      kind: "created";
      mode: "create" | "duplicate";
      planId: number;
      planName: string;
      createdCase: KiwiCase;
      sourceCaseId?: number;
    };

type ClientFactory = () => Promise<{
  adapter: KiwiAdapter;
  config: KiwiConfig;
}>;

type PanelSession = {
  key: string;
  target: MetadataEditorTarget;
  panel: vscode.WebviewPanel;
  formState: CaseMetadataFormState;
  options: MetadataEditorOptions;
  sourceCase?: KiwiCase;
  sourceText: string;
  isSaving: boolean;
};

type WebviewState = {
  formState: CaseMetadataFormState;
  options: MetadataEditorOptions;
  isSaving: boolean;
  mode: MetadataEditorMode;
  actionLabel: string;
};

export class CaseMetadataEditorController implements vscode.Disposable {
  private readonly sessions = new Map<string, PanelSession>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly onSaved: (result: MetadataEditorSaveResult) => Promise<void>
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

  async open(target: MetadataEditorTarget): Promise<vscode.WebviewPanel> {
    const key = sessionKey(target);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.target = target;
      existing.panel.title = panelTitle(target, existing.sourceCase);
      existing.panel.reveal(existing.panel.viewColumn, false);
      await this.reload(existing);
      return existing.panel;
    }

    const initial = await this.loadState(target);
    const panel = vscode.window.createWebviewPanel(
      "kiwiCaseMetadataEditor",
      panelTitle(target, initial.sourceCase),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    const session: PanelSession = {
      key,
      target,
      panel,
      formState: initial.formState,
      options: initial.options,
      sourceCase: initial.sourceCase,
      sourceText: initial.sourceText,
      isSaving: false
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

  getStateForTest(
    identifier: number,
    mode: MetadataEditorMode = "edit"
  ): {
    formState: CaseMetadataFormState;
    options: MetadataEditorOptions;
    title: string;
    actionLabel: string;
    mode: MetadataEditorMode;
  } | undefined {
    const session = this.sessions.get(testSessionKey(identifier, mode));
    if (!session) {
      return undefined;
    }
    return {
      formState: { ...session.formState },
      options: {
        statuses: [...session.options.statuses],
        priorities: [...session.options.priorities]
      },
      title: session.panel.title,
      actionLabel: actionLabel(session.target.mode),
      mode: session.target.mode
    };
  }

  async submitForTest(
    identifier: number,
    formState: CaseMetadataFormState,
    mode: MetadataEditorMode = "edit"
  ): Promise<MetadataEditorSaveResult> {
    const session = this.sessions.get(testSessionKey(identifier, mode));
    if (!session) {
      throw new KiwiError(
        "ValidationFailed",
        `Metadata editor for ${mode}:${identifier} is not open.`
      );
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
        case "cancel":
          session.panel.dispose();
          break;
        default:
          break;
      }
    } catch (error) {
      session.panel.webview.postMessage({
        type: "error",
        message: humanMessage(error)
      });
      void vscode.window.showErrorMessage(humanMessage(error));
    }
  }

  private async save(
    session: PanelSession,
    formState: CaseMetadataFormState
  ): Promise<MetadataEditorSaveResult> {
    session.isSaving = true;
    this.pushState(session);
    try {
      if (session.target.mode === "edit") {
        return await this.saveEdit(session, formState);
      }
      return await this.saveCreateLike(session, formState);
    } finally {
      session.isSaving = false;
      if (this.sessions.has(session.key)) {
        this.pushState(session);
      }
    }
  }

  private async saveEdit(
    session: PanelSession,
    formState: CaseMetadataFormState
  ): Promise<MetadataEditorSaveResult> {
    if (!session.sourceCase || session.target.mode !== "edit") {
      throw new KiwiError("ValidationFailed", "Editable case metadata is not loaded.");
    }

    const next = toEditableCaseMetadata(formState, session.options);
    const patch = diffCaseMetadataPatch(session.sourceCase, next);
    if (Object.keys(patch).length === 0) {
      session.formState = toCaseMetadataFormState(session.sourceCase);
      this.pushState(session);
      return {
        kind: "updated",
        planId: session.target.plan.id,
        planName: session.target.plan.name,
        caseId: session.target.caseRef.id,
        oldSummary: session.sourceCase.summary,
        updatedCase: session.sourceCase,
        changedFields: []
      };
    }

    const { adapter, config } = await this.clientFactory();
    const updatedCase = await adapter.updateCaseMetadata(config, session.target.caseRef.id, patch);
    const result: MetadataEditorSaveResult = {
      kind: "updated",
      planId: session.target.plan.id,
      planName: session.target.plan.name,
      caseId: session.target.caseRef.id,
      oldSummary: session.sourceCase.summary,
      updatedCase,
      changedFields: Object.keys(patch) as Array<keyof KiwiCaseMetadataPatch>
    };
    session.sourceCase = updatedCase;
    session.formState = toCaseMetadataFormState(updatedCase);
    session.target = {
      ...session.target,
      caseRef: {
        id: session.target.caseRef.id,
        summary: updatedCase.summary
      }
    };
    session.panel.title = panelTitle(session.target, updatedCase);
    this.pushState(session);
    await this.onSaved(result);
    return result;
  }

  private async saveCreateLike(
    session: PanelSession,
    formState: CaseMetadataFormState
  ): Promise<MetadataEditorSaveResult> {
    const { adapter, config } = await this.clientFactory();
    const payload = toCaseCreatePayload(formState, session.options, session.sourceText);
    const createdCase = await adapter.createCase(config, session.target.plan.id, payload);
    const creationMode = session.target.mode === "create" ? "create" : "duplicate";
    const result: MetadataEditorSaveResult = {
      kind: "created",
      mode: creationMode,
      planId: session.target.plan.id,
      planName: session.target.plan.name,
      createdCase,
      sourceCaseId:
        creationMode === "duplicate" && "caseRef" in session.target
          ? session.target.caseRef.id
          : undefined
    };
    await this.onSaved(result);
    session.panel.dispose();
    return result;
  }

  private async reload(session: PanelSession): Promise<void> {
    const loaded = await this.loadState(session.target);
    session.formState = loaded.formState;
    session.options = loaded.options;
    session.sourceCase = loaded.sourceCase;
    session.sourceText = loaded.sourceText;
    session.panel.title = panelTitle(session.target, loaded.sourceCase);
    this.pushState(session);
  }

  private async loadState(
    target: MetadataEditorTarget
  ): Promise<{
    formState: CaseMetadataFormState;
    options: MetadataEditorOptions;
    sourceCase?: KiwiCase;
    sourceText: string;
  }> {
    const { adapter, config } = await this.clientFactory();
    const [statuses, priorities] = await Promise.all([
      adapter.listCaseStatuses(config),
      adapter.listPriorities(config)
    ]);
    const options = { statuses, priorities };

    if (target.mode === "edit" || target.mode === "duplicate") {
      const caseData = await adapter.getCase(config, target.caseRef.id, target.plan.id);
      return {
        formState: toCaseMetadataFormState(caseData),
        options,
        sourceCase: caseData,
        sourceText: target.mode === "duplicate" ? caseData.text : ""
      };
    }

    if (statuses.length === 0 || priorities.length === 0) {
      throw new KiwiError(
        "ValidationFailed",
        "Status または Priority の候補が取得できませんでした。"
      );
    }

    return {
      formState: {
        summary: "",
        status: statuses[0],
        priority: priorities[0],
        tagsInput: ""
      },
      options,
      sourceText: DEFAULT_CASE_BODY_TEMPLATE
    };
  }

  private pushState(session: PanelSession): void {
    const state: WebviewState = {
      formState: session.formState,
      options: session.options,
      isSaving: session.isSaving,
      mode: session.target.mode,
      actionLabel: actionLabel(session.target.mode)
    };
    session.panel.webview.postMessage({
      type: "state",
      ...state
    });
  }
}

function renderWebviewHtml(webview: vscode.Webview, session: PanelSession): string {
  const nonce = createNonce();
  const bootstrap = JSON.stringify({
    formState: session.formState,
    options: session.options,
    isSaving: session.isSaving,
    mode: session.target.mode,
    actionLabel: actionLabel(session.target.mode)
  });

  return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(session.panel.title)}</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        margin: 0;
        padding: 20px;
      }
      form {
        display: grid;
        gap: 16px;
        max-width: 720px;
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
      .description {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .actions {
        display: flex;
        gap: 8px;
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
      .error {
        min-height: 1.2em;
        color: var(--vscode-errorForeground);
      }
    </style>
  </head>
  <body>
    <form id="form">
      <div class="description" id="description"></div>
      <label>Summary
        <input id="summary" type="text" />
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
      <div class="error" id="error"></div>
      <div class="actions">
        <button class="primary" id="save" type="submit">保存</button>
        <button class="secondary" id="reload" type="button">再読み込み</button>
        <button class="secondary" id="cancel" type="button">キャンセル</button>
      </div>
    </form>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const form = document.getElementById('form');
      const summary = document.getElementById('summary');
      const status = document.getElementById('status');
      const priority = document.getElementById('priority');
      const tagsInput = document.getElementById('tagsInput');
      const description = document.getElementById('description');
      const saveButton = document.getElementById('save');
      const reloadButton = document.getElementById('reload');
      const cancelButton = document.getElementById('cancel');
      const error = document.getElementById('error');
      let state = ${bootstrap};

      function renderSelect(select, values, current) {
        select.innerHTML = '';
        for (const value of values) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          option.selected = value === current;
          select.appendChild(option);
        }
      }

      function renderDescription(mode) {
        if (mode === 'create') {
          return 'metadata を入力して新規テストケースを作成します。本文は作成後に Case Document で編集します。';
        }
        if (mode === 'duplicate') {
          return '元の本文を複製して新しいテストケースを作成します。本文は作成後に Case Document で編集します。';
        }
        return 'metadata を編集します。本文は更新しません。';
      }

      function render() {
        summary.value = state.formState.summary;
        tagsInput.value = state.formState.tagsInput;
        renderSelect(status, state.options.statuses, state.formState.status);
        renderSelect(priority, state.options.priorities, state.formState.priority);
        description.textContent = renderDescription(state.mode);
        saveButton.disabled = state.isSaving;
        saveButton.textContent = state.actionLabel;
        reloadButton.disabled = state.isSaving;
      }

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        error.textContent = '';
        vscode.postMessage({
          type: 'save',
          formState: {
            summary: summary.value,
            status: status.value,
            priority: priority.value,
            tagsInput: tagsInput.value
          }
        });
      });
      reloadButton.addEventListener('click', () => {
        error.textContent = '';
        vscode.postMessage({ type: 'reload' });
      });
      cancelButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancel' });
      });
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'state') {
          state = message;
          render();
        } else if (message.type === 'error') {
          error.textContent = message.message;
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
  | { type: "save"; formState: CaseMetadataFormState }
  | { type: "reload" }
  | { type: "cancel" } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  if (type === "reload" || type === "cancel") {
    return true;
  }
  if (type === "save") {
    const formState = (value as { formState?: CaseMetadataFormState }).formState;
    return Boolean(
      formState &&
        typeof formState.summary === "string" &&
        typeof formState.status === "string" &&
        typeof formState.priority === "string" &&
        typeof formState.tagsInput === "string"
    );
  }
  return false;
}

function sessionKey(target: MetadataEditorTarget): string {
  if (target.mode === "create") {
    return `create:${target.plan.id}`;
  }
  return `${target.mode}:${target.caseRef.id}`;
}

function testSessionKey(identifier: number, mode: MetadataEditorMode): string {
  if (mode === "create") {
    return `create:${identifier}`;
  }
  return `${mode}:${identifier}`;
}

function actionLabel(mode: MetadataEditorMode): string {
  switch (mode) {
    case "create":
      return "作成";
    case "duplicate":
      return "複製して作成";
    default:
      return "保存";
  }
}

function panelTitle(target: MetadataEditorTarget, sourceCase?: KiwiCase): string {
  switch (target.mode) {
    case "create":
      return `新規テストケースを作成: ${target.plan.name}`;
    case "duplicate":
      return `このテストケースを複製: ${sourceCase?.summary ?? target.caseRef.summary}`;
    default:
      return `テストケースメタデータを編集: ${sourceCase?.summary ?? target.caseRef.summary}`;
  }
}

function createNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function humanMessage(error: unknown): string {
  if (error instanceof KiwiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
