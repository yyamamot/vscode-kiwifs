import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { KiwiError } from "../domain/errors";
import { KiwiConfig, KiwiPlan, KiwiTestRun } from "../types";
import type { UiReviewSnapshot } from "../harness/ui-review";
import { localize } from "./l10n";
import { renderTestRunFilterWebviewHtml } from "./webview/testRunFilterView";

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

type PendingUiReviewSnapshot = {
  resolve: (snapshot: UiReviewSnapshot) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
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
  private pendingUiReviewSnapshot: PendingUiReviewSnapshot | undefined;
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
      localize("Find Test Runs"),
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
      message: localize("Enter conditions and search.")
    };
    this.session = session;
    panel.webview.html = renderTestRunFilterWebviewHtml(panel.webview);
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

  async captureUiReviewSnapshotForTest(reason = "test"): Promise<UiReviewSnapshot> {
    if (!this.session) {
      throw new KiwiError("ValidationFailed", "Test Run filter panel is not open.");
    }

    this.pendingUiReviewSnapshot?.reject(new Error("A newer UI review snapshot request replaced this request."));
    clearTimeout(this.pendingUiReviewSnapshot?.timeout);

    return new Promise<UiReviewSnapshot>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingUiReviewSnapshot?.resolve === resolve) {
          this.pendingUiReviewSnapshot = undefined;
        }
        reject(new Error("Timed out waiting for test run filter UI review snapshot."));
      }, 5000);
      this.pendingUiReviewSnapshot = { resolve, reject, timeout };
      void this.session?.panel.webview.postMessage({
        type: "requestUiReviewSnapshot",
        reason
      }).then((accepted) => {
        if (!accepted && this.pendingUiReviewSnapshot?.resolve === resolve) {
          clearTimeout(timeout);
          this.pendingUiReviewSnapshot = undefined;
          reject(new Error("Test run filter Webview did not accept the UI review snapshot request."));
        }
      });
    });
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
          session.message = localize("Enter conditions and search.");
          this.pushState(session);
          break;
        case "reload":
          await this.reload(session);
          break;
        case "open":
          await this.openResult(session, message.runId);
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
      session.message = localize("Enter conditions and search.");
      this.pushState(session);
      return [];
    }

    session.isSearching = true;
    session.message = localize("Searching Test Runs...");
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
          ? localize("No matching Test Runs.")
          : localize("Showing {0} Test Runs.", session.results.length);
      this.pushState(session);
      return session.results;
    } finally {
      session.isSearching = false;
      this.pushState(session);
    }
  }

  private async openResult(session: PanelSession, runId: number): Promise<void> {
    await this.openRun(runId);
    session.message = localize("Opened Test Run {0} in the dashboard.", runId);
    this.pushState(session);
  }

  private async loadOptions(): Promise<TestRunFilterOptions> {
    const { adapter, config } = await this.clientFactory();
    const [plans, runs] = await Promise.all([adapter.listPlans(config), adapter.listTestRuns(config)]);
    return {
      plans: [
        { value: "", label: localize("All Plans") },
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
  | { type: "open"; runId: number }
  | { type: "ui-review-snapshot"; snapshot: UiReviewSnapshot } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  if (type === "ui-review-snapshot") {
    return Boolean((value as { snapshot?: unknown }).snapshot);
  }
  return typeof type === "string";
}
