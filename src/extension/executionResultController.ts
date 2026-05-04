import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { KiwiError } from "../domain/errors";
import {
  diffExecutionResultPatch,
  ExecutionResultFormState,
  toExecutionResultFormState
} from "../domain/executionResultForm";
import { KiwiCaseExecution, KiwiConfig, KiwiExecutionStatus, KiwiExecutionUpdatePatch } from "../types";
import { localize } from "./l10n";
import { renderExecutionResultWebviewHtml } from "./webview/executionResultView";

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
      message: localize("Enter an execution result.")
    };
    this.sessions.set(key, session);
    panel.webview.html = renderExecutionResultWebviewHtml(panel.webview, panelTitle(session.target), toWebviewState(session));

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
    session.message = localize("Saving...");
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
      session.message = changedFields.length === 0 ? localize("No changes.") : localize("Saved execution result.");
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
    session.message = localize("Reloaded.");
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
  return localize("Update Test Case Execution Result: {0} - {1}", target.caseRef.id, target.caseRef.summary);
}

function humanMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
