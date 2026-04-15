import * as vscode from "vscode";
import { KiwiAdapter } from "../adapter/types";
import { KiwiConfig, KiwiPlan, PlanCaseRef } from "../types";
import { planDirectoryName, caseFileName } from "../domain/pathCodec";
import { JsonlLogger } from "../logging/jsonlLogger";
import { KiwiError } from "../domain/errors";

type KiwiClient = {
  adapter: KiwiAdapter;
  config: KiwiConfig;
};

type PlanNode = {
  kind: "plan";
  plan: KiwiPlan;
};

type CaseNode = {
  kind: "case";
  plan: KiwiPlan;
  caseRef: PlanCaseRef;
};

export type KiwiPlansTreeNode = PlanNode | CaseNode;

export type KiwiPlansTreeSnapshotNode = {
  kind: KiwiPlansTreeNode["kind"];
  label: string;
  description?: string;
  tooltip?: string;
  children?: KiwiPlansTreeSnapshotNode[];
};

export type CaseFreshnessDecoration = {
  status: "stale";
  message: string;
  checkedAt: number;
};

const STALE_CASE_ICON = new vscode.ThemeIcon(
  "warning",
  new vscode.ThemeColor("problemsWarningIcon.foreground")
);

export function caseInfoUri(plan: KiwiPlan, caseRef: PlanCaseRef): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-info:/plans/${planDirectoryName(plan)}/cases/${caseFileName(caseRef)}`
  );
}

export function caseDocumentUri(plan: KiwiPlan, caseRef: PlanCaseRef): vscode.Uri {
  return vscode.Uri.parse(`kiwi:/plans/${planDirectoryName(plan)}/cases/${caseFileName(caseRef)}`);
}

export class KiwiPlansTreeDataProvider
  implements vscode.TreeDataProvider<KiwiPlansTreeNode> {
  private readonly emitter = new vscode.EventEmitter<KiwiPlansTreeNode | undefined>();
  private readonly planListCache = new Map<number, KiwiPlan>();
  private readonly caseListCache = new Map<number, PlanCaseRef[]>();
  private readonly staleCases = new Map<number, CaseFreshnessDecoration>();

  constructor(
    private readonly clientFactory: () => Promise<KiwiClient>,
    private readonly logger: JsonlLogger
  ) {}

  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.planListCache.clear();
    this.caseListCache.clear();
    this.staleCases.clear();
    this.emitter.fire(undefined);
  }

  markCaseStale(caseId: number, message = "remote changed"): void {
    this.staleCases.set(caseId, {
      status: "stale",
      message,
      checkedAt: Date.now()
    });
    this.emitter.fire(undefined);
  }

  clearCaseFreshness(caseId: number): void {
    if (this.staleCases.delete(caseId)) {
      this.emitter.fire(undefined);
    }
  }

  async getTreeItem(element: KiwiPlansTreeNode): Promise<vscode.TreeItem> {
    switch (element.kind) {
      case "plan": {
        const item = new vscode.TreeItem(
          planDirectoryName(element.plan),
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.contextValue = "plan";
        return item;
      }

      case "case": {
        const uri = caseDocumentUri(element.plan, element.caseRef);
        const item = new vscode.TreeItem(
          caseFileName(element.caseRef),
          vscode.TreeItemCollapsibleState.None
        );
        item.contextValue = "caseDocument";
        item.resourceUri = uri;
        item.command = {
          command: "vscode.open",
          title: "Open",
          arguments: [uri]
        };
        const stale = this.staleCases.get(element.caseRef.id);
        if (stale) {
          item.description = "remote changed";
          item.tooltip = `${caseFileName(element.caseRef)}\n${stale.message}`;
          item.iconPath = STALE_CASE_ICON;
        }
        return item;
      }
    }
  }

  async getChildren(element?: KiwiPlansTreeNode): Promise<KiwiPlansTreeNode[]> {
    if (!element) {
      return this.listPlans();
    }

    switch (element.kind) {
      case "plan":
        return this.listCases(element.plan);

      default:
        return [];
    }
  }

  async snapshot(): Promise<KiwiPlansTreeSnapshotNode[]> {
    const plans = await this.getChildren();
    const result: KiwiPlansTreeSnapshotNode[] = [];

    for (const plan of plans) {
      const planItem = await this.getTreeItem(plan);
      const planChildren = await this.getChildren(plan);
      const snapshotPlan: KiwiPlansTreeSnapshotNode = {
        kind: plan.kind,
        label: planItem.label as string,
        children: []
      };

      for (const child of planChildren) {
        const childItem = await this.getTreeItem(child);
        const snapshotChild: KiwiPlansTreeSnapshotNode = {
          kind: child.kind,
          label: childItem.label as string
        };
        if (typeof childItem.description === "string") {
          snapshotChild.description = childItem.description;
        }
        if (typeof childItem.tooltip === "string") {
          snapshotChild.tooltip = childItem.tooltip;
        }

        const grandChildren = await this.getChildren(child);
        if (grandChildren.length > 0) {
          snapshotChild.children = [];
          for (const grandChild of grandChildren) {
            const grandChildItem = await this.getTreeItem(grandChild);
            snapshotChild.children.push({
              kind: grandChild.kind,
              label: grandChildItem.label as string,
              description: typeof grandChildItem.description === "string"
                ? grandChildItem.description
                : undefined,
              tooltip: typeof grandChildItem.tooltip === "string"
                ? grandChildItem.tooltip
                : undefined
            });
          }
        }

        snapshotPlan.children?.push(snapshotChild);
      }

      result.push(snapshotPlan);
    }

    return result;
  }

  private async listPlans(): Promise<KiwiPlansTreeNode[]> {
    if (this.planListCache.size > 0) {
      return [...this.planListCache.values()]
        .sort((left, right) => left.id - right.id)
        .map((plan) => ({ kind: "plan", plan }));
    }

    logInBackground(this.logger, {
      level: "info",
      event: "plan.list.started",
      source: "listingStrategy",
      operation: "getChildren",
      entityType: "directory",
      entityId: "plans",
      virtualPath: "kiwi:/plans/",
      outcome: "started"
    });

    try {
      const { adapter, config } = await this.clientFactory();
      const plans = (await adapter.listPlans(config)).sort((left, right) => left.id - right.id);
      this.planListCache.clear();
      for (const plan of plans) {
        this.planListCache.set(plan.id, plan);
      }
      logInBackground(this.logger, {
        level: "info",
        event: "plan.list.succeeded",
        source: "listingStrategy",
        operation: "getChildren",
        entityType: "directory",
        entityId: "plans",
        virtualPath: "kiwi:/plans/",
        outcome: "succeeded"
      });
      return plans.map((plan) => ({ kind: "plan", plan }));
    } catch (error) {
      await this.logger.log({
        level: "error",
        event: "plan.list.failed",
        source: "listingStrategy",
        operation: "getChildren",
        entityType: "directory",
        entityId: "plans",
        virtualPath: "kiwi:/plans/",
        outcome: "failed",
        errorCode: normalizeErrorCode(error),
        message: error instanceof Error ? error.message : String(error)
      });
      void vscode.window.showErrorMessage(humanMessage(error));
      return [];
    }
  }

  private async listCases(plan: KiwiPlan): Promise<KiwiPlansTreeNode[]> {
    const cached = this.caseListCache.get(plan.id);
    if (cached) {
      return cached.map((caseRef) => ({ kind: "case", plan, caseRef }));
    }

    const planPath = `kiwi:/plans/${planDirectoryName(plan)}/cases/`;
    logInBackground(this.logger, {
      level: "info",
      event: "case.list.started",
      source: "listingStrategy",
      operation: "getChildren",
      entityType: "directory",
      entityId: String(plan.id),
      virtualPath: planPath,
      outcome: "started"
    });

    try {
      const { adapter, config } = await this.clientFactory();
      const cases = (await adapter.listPlanCases(config, plan.id)).sort((left, right) => left.id - right.id);
      this.caseListCache.set(plan.id, cases);
      logInBackground(this.logger, {
        level: "info",
        event: "case.list.succeeded",
        source: "listingStrategy",
        operation: "getChildren",
        entityType: "directory",
        entityId: String(plan.id),
        virtualPath: planPath,
        outcome: "succeeded"
      });
      return cases.map((caseRef) => ({ kind: "case", plan, caseRef }));
    } catch (error) {
      await this.logger.log({
        level: "error",
        event: "case.list.failed",
        source: "listingStrategy",
        operation: "getChildren",
        entityType: "directory",
        entityId: String(plan.id),
        virtualPath: planPath,
        outcome: "failed",
        errorCode: normalizeErrorCode(error),
        message: error instanceof Error ? error.message : String(error)
      });
      void vscode.window.showErrorMessage(humanMessage(error));
      return [];
    }
  }
}

function normalizeErrorCode(error: unknown): string {
  if (error instanceof KiwiError) {
    return error.code;
  }
  if (error instanceof vscode.FileSystemError) {
    return error.code;
  }
  return "Unknown";
}

function humanMessage(error: unknown): string {
  if (error instanceof KiwiError) {
    switch (error.code) {
      case "AuthenticationFailed":
        return "Kiwi authentication failed. Verify the base URL, username, and password settings.";
      case "AuthorizationFailed":
        return "Kiwi authorization failed. Your account cannot access this data.";
      case "ConnectionFailed":
        return "Kiwi connection failed. Verify the base URL and server status.";
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function logInBackground(
  logger: JsonlLogger,
  event: Parameters<JsonlLogger["log"]>[0]
): void {
  void logger.log(event).catch(() => undefined);
}
