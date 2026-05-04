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
import type { UiReviewSnapshot } from "../harness/ui-review";
import { localize } from "./l10n";
import { renderCaseFilterWebviewHtml } from "./webview/caseFilterView";

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

type PendingUiReviewSnapshot = {
  resolve: (snapshot: UiReviewSnapshot) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
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
  private pendingUiReviewSnapshot: PendingUiReviewSnapshot | undefined;
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
      localize("Find Test Cases"),
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
      message: localize("Enter conditions and search.")
    };
    this.session = session;

    panel.webview.html = renderCaseFilterWebviewHtml(panel.webview, toWebviewState(session));
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

  async captureUiReviewSnapshotForTest(reason = "test"): Promise<UiReviewSnapshot> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Case filter panel is not open.");
    }

    this.pendingUiReviewSnapshot?.reject(new Error("A newer UI review snapshot request replaced this request."));
    clearTimeout(this.pendingUiReviewSnapshot?.timeout);

    return new Promise<UiReviewSnapshot>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingUiReviewSnapshot?.resolve === resolve) {
          this.pendingUiReviewSnapshot = undefined;
        }
        reject(new Error("Timed out waiting for case filter UI review snapshot."));
      }, 5000);
      this.pendingUiReviewSnapshot = { resolve, reject, timeout };
      void this.session?.panel.webview.postMessage({
        type: "requestUiReviewSnapshot",
        reason
      }).then((accepted) => {
        if (!accepted && this.pendingUiReviewSnapshot?.resolve === resolve) {
          clearTimeout(timeout);
          this.pendingUiReviewSnapshot = undefined;
          reject(new Error("Case filter Webview did not accept the UI review snapshot request."));
        }
      });
    });
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
          session.message = localize("Enter conditions and search.");
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
        case "ui-review-snapshot":
          if (this.pendingUiReviewSnapshot) {
            clearTimeout(this.pendingUiReviewSnapshot.timeout);
            this.pendingUiReviewSnapshot.resolve(message.snapshot);
            this.pendingUiReviewSnapshot = undefined;
          }
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
    session.message = localize("Searching...");
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
    session.message = localize("Enter conditions and search.");
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
      session.message = localize("Select test cases to bulk update.");
      this.pushState(session);
      return;
    }
    const picked = await vscode.window.showQuickPick(
      session.options.statuses.map((status) => ({ label: status, status })),
      { placeHolder: localize("Select a status to apply to selected test cases") }
    );
    if (!picked) {
      return;
    }
    const proceed =
      (await vscode.window.showWarningMessage(
        localize("Apply status={0} to {1} test cases?", picked.status, caseIds.length),
        { modal: true },
        localize("Apply")
      )) === localize("Apply");
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
    session.message = localize("Bulk updating status...");
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
      session.message = localize("Select test cases to bulk update.");
      this.pushState(session);
      return;
    }
    const tagsInput = await vscode.window.showInputBox({
      prompt: mode === "add"
        ? localize("Enter comma-separated tags to add")
        : localize("Enter comma-separated tags to remove"),
      placeHolder: "smoke, regression"
    });
    if (tagsInput === undefined) {
      return;
    }
    const normalizedTags = normalizeTags(tagsInput);
    if (normalizedTags.length === 0) {
      session.message = localize("Enter tags.");
      this.pushState(session);
      return;
    }
    const actionLabel = mode === "add" ? localize("Add") : localize("Remove");
    const proceed =
      (await vscode.window.showWarningMessage(
        localize("{0} tags for {1} test cases?", actionLabel, caseIds.length),
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
    session.message = mode === "add" ? localize("Bulk adding tags...") : localize("Bulk removing tags...");
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
    return localize("No matching test cases.");
  }
  const page = visiblePage(session);
  return localize("Showing {0} / Total {1} / Selected {2}", page.visibleCount, page.totalCount, session.selectedCaseIds.length);
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
  | { type: "open"; caseId: number }
  | { type: "ui-review-snapshot"; snapshot: UiReviewSnapshot } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  if (type === "clear" || type === "loadMore" || type === "reload" || type === "close") {
    return true;
  }
  if (type === "ui-review-snapshot") {
    return Boolean((value as { snapshot?: unknown }).snapshot);
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
