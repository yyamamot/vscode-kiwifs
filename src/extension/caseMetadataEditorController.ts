import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { KiwiCase, KiwiCaseCreatePayload, KiwiCaseMetadataPatch, KiwiConfig } from "../types";
import {
  buildCaseTemplateOptions,
  CaseTemplateOption,
  CaseMetadataFormState,
  DEFAULT_CASE_BODY_TEMPLATE,
  DEFAULT_TEMPLATE_ID,
  diffCaseMetadataPatch,
  resolveCaseTemplateText,
  toCaseCreatePayload,
  toCaseMetadataFormState,
  toEditableCaseMetadata
} from "../domain/caseMetadataDocument";
import { KiwiError } from "../domain/errors";
import { localize } from "./l10n";
import { renderCaseMetadataEditorWebviewHtml } from "./webview/caseMetadataEditorView";

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
  templateOptions: CaseTemplateOption[];
  selectedTemplateId: string;
  templateWarning?: string;
  sourceCase?: KiwiCase;
  sourceText: string;
  isSaving: boolean;
};

type WebviewState = {
  formState: CaseMetadataFormState;
  options: MetadataEditorOptions;
  templateOptions: CaseTemplateOption[];
  selectedTemplateId: string;
  templateWarning?: string;
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
      templateOptions: initial.templateOptions,
      selectedTemplateId: initial.selectedTemplateId,
      templateWarning: initial.templateWarning,
      sourceCase: initial.sourceCase,
      sourceText: initial.sourceText,
      isSaving: false
    };
    this.sessions.set(key, session);

    panel.webview.html = renderCaseMetadataEditorWebviewHtml(panel.webview, session.panel.title, {
      formState: session.formState,
      options: session.options,
      templateOptions: session.templateOptions,
      selectedTemplateId: session.selectedTemplateId,
      templateWarning: session.templateWarning,
      isSaving: session.isSaving,
      mode: session.target.mode,
      actionLabel: actionLabel(session.target.mode)
    });
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
    templateOptions: CaseTemplateOption[];
    selectedTemplateId: string;
    templateWarning?: string;
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
      templateOptions: session.templateOptions.map((option) => ({ ...option })),
      selectedTemplateId: session.selectedTemplateId,
      templateWarning: session.templateWarning,
      title: session.panel.title,
      actionLabel: actionLabel(session.target.mode),
      mode: session.target.mode
    };
  }

  async submitForTest(
    identifier: number,
    formState: CaseMetadataFormState,
    mode: MetadataEditorMode = "edit",
    selectedTemplateId?: string
  ): Promise<MetadataEditorSaveResult> {
    const session = this.sessions.get(testSessionKey(identifier, mode));
    if (!session) {
      throw new KiwiError(
        "ValidationFailed",
        `Metadata editor for ${mode}:${identifier} is not open.`
      );
    }
    return this.save(session, formState, selectedTemplateId);
  }

  private async handleMessage(session: PanelSession, message: unknown): Promise<void> {
    if (!isMessage(message)) {
      return;
    }

    try {
      switch (message.type) {
        case "save":
          await this.save(session, message.formState, message.selectedTemplateId);
          break;
        case "reload":
          session.selectedTemplateId = message.selectedTemplateId ?? session.selectedTemplateId;
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
    formState: CaseMetadataFormState,
    selectedTemplateId?: string
  ): Promise<MetadataEditorSaveResult> {
    session.isSaving = true;
    this.pushState(session);
    try {
      if (session.target.mode === "edit") {
        return await this.saveEdit(session, formState);
      }
      return await this.saveCreateLike(session, formState, selectedTemplateId);
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
    formState: CaseMetadataFormState,
    selectedTemplateId?: string
  ): Promise<MetadataEditorSaveResult> {
    const { adapter, config } = await this.clientFactory();
    if (session.target.mode === "create") {
      session.selectedTemplateId = selectedTemplateId ?? session.selectedTemplateId;
      session.sourceText = resolveCaseTemplateText(session.templateOptions, session.selectedTemplateId);
    }
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
    session.templateOptions = loaded.templateOptions;
    session.selectedTemplateId = resolveSelectedTemplateId(
      loaded.templateOptions,
      session.selectedTemplateId
    );
    session.templateWarning = loaded.templateWarning;
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
    templateOptions: CaseTemplateOption[];
    selectedTemplateId: string;
    templateWarning?: string;
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
        templateOptions: [],
        selectedTemplateId: DEFAULT_TEMPLATE_ID,
        sourceCase: caseData,
        sourceText: target.mode === "duplicate" ? caseData.text : ""
      };
    }

    if (statuses.length === 0 || priorities.length === 0) {
      throw new KiwiError(
        "ValidationFailed",
        localize("Status or Priority candidates could not be loaded.")
      );
    }

    const templateState = await loadTemplateState(adapter, config);
    return {
      formState: {
        summary: "",
        status: statuses[0],
        priority: priorities[0],
        tagsInput: ""
      },
      options,
      templateOptions: templateState.templateOptions,
      selectedTemplateId: DEFAULT_TEMPLATE_ID,
      templateWarning: templateState.templateWarning,
      sourceText: DEFAULT_CASE_BODY_TEMPLATE
    };
  }

  private pushState(session: PanelSession): void {
    const state: WebviewState = {
      formState: session.formState,
      options: session.options,
      templateOptions: session.templateOptions,
      selectedTemplateId: session.selectedTemplateId,
      templateWarning: session.templateWarning,
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

function isMessage(
  value: unknown
): value is
  | { type: "save"; formState: CaseMetadataFormState; selectedTemplateId?: string }
  | { type: "reload"; selectedTemplateId?: string }
  | { type: "cancel" } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  if (type === "cancel") {
    return true;
  }
  if (type === "reload") {
    return (
      (value as { selectedTemplateId?: unknown }).selectedTemplateId === undefined ||
      typeof (value as { selectedTemplateId?: unknown }).selectedTemplateId === "string"
    );
  }
  if (type === "save") {
    const formState = (value as { formState?: CaseMetadataFormState }).formState;
    return Boolean(
      formState &&
        typeof formState.summary === "string" &&
        typeof formState.status === "string" &&
        typeof formState.priority === "string" &&
        typeof formState.tagsInput === "string" &&
        ((value as { selectedTemplateId?: unknown }).selectedTemplateId === undefined ||
          typeof (value as { selectedTemplateId?: unknown }).selectedTemplateId === "string")
    );
  }
  return false;
}

async function loadTemplateState(
  adapter: KiwiAdapter,
  config: KiwiConfig
): Promise<{ templateOptions: CaseTemplateOption[]; templateWarning?: string }> {
  try {
    return {
      templateOptions: buildCaseTemplateOptions(await adapter.listCaseTemplates(config))
    };
  } catch (error) {
    return {
      templateOptions: buildCaseTemplateOptions([]),
      templateWarning: localize("Could not load Kiwi templates. You can create with the default template.")
    };
  }
}

function resolveSelectedTemplateId(
  templateOptions: CaseTemplateOption[],
  selectedTemplateId: string
): string {
  return templateOptions.some((option) => option.id === selectedTemplateId)
    ? selectedTemplateId
    : DEFAULT_TEMPLATE_ID;
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
      return localize("Create");
    case "duplicate":
      return localize("Duplicate and Create");
    default:
      return localize("Save");
  }
}

function panelTitle(target: MetadataEditorTarget, sourceCase?: KiwiCase): string {
  switch (target.mode) {
    case "create":
      return localize("Create New Test Case in Test Plan: {0}", target.plan.name);
    case "duplicate":
      return localize("Duplicate Test Case: {0}", sourceCase?.summary ?? target.caseRef.summary);
    default:
      return localize("Edit Test Case Basic Information: {0}", sourceCase?.summary ?? target.caseRef.summary);
  }
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
