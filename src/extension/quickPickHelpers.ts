import * as vscode from "vscode";
import {
  type AttachmentQuickPickItem
} from "./buildAttachmentQuickPickItems";
import {
  buildCaseSearchQuickPickItems,
  paginateCaseSearchItems,
  type CaseSearchQuickPickItem
} from "./buildCaseSearchQuickPickItems";
import {
  type ExistingCaseToPlanQuickPickItem
} from "./buildExistingCaseToPlanQuickPickItems";
import {
  type RemoveCaseFromPlanQuickPickItem
} from "./buildRemoveCaseFromPlanQuickPickItems";
import {
  type ExecutionQuickPickItem
} from "./buildExecutionQuickPickItems";
import {
  buildCaseHistoryDiffQuickPickItems,
  type CaseHistoryDiffPair
} from "./buildCaseHistoryQuickPickItems";

export function buildVisibleCaseSearchItems(
  matches: Parameters<typeof buildCaseSearchQuickPickItems>[0],
  visibleCount: number
): CaseSearchQuickPickItem[] {
  const page = paginateCaseSearchItems(matches, visibleCount);
  return buildCaseSearchQuickPickItems(page.visibleItems, {
    totalCount: page.totalCount,
    hasMore: page.hasMore
  });
}

export function serializeCaseSearchItems(items: CaseSearchQuickPickItem[]): Array<{
  label: string;
  description: string;
  detail: string;
  itemType: string;
  caseId: number;
  planId: number;
}> {
  return items.map((item) => ({
    label: item.label,
    description: item.description,
    detail: item.detail,
    itemType: item.itemType,
    caseId: item.caseRef.id,
    planId: item.plan.id
  }));
}

export async function pickAttachmentForBrowser(
  items: AttachmentQuickPickItem[],
  placeHolder: string
): Promise<AttachmentQuickPickItem | undefined> {
  return vscode.window.showQuickPick(items, {
    placeHolder,
    matchOnDescription: true,
    matchOnDetail: true
  });
}

export async function pickCaseSearchItem(
  items: CaseSearchQuickPickItem[]
): Promise<CaseSearchQuickPickItem | undefined> {
  return vscode.window.showQuickPick(items, {
    placeHolder: "開くテストケースを選択してください",
    matchOnDescription: true,
    matchOnDetail: true
  });
}

export async function pickExistingCaseToPlanItem(
  items: ExistingCaseToPlanQuickPickItem[]
): Promise<ExistingCaseToPlanQuickPickItem | undefined> {
  return vscode.window.showQuickPick(items, {
    placeHolder: "この計画に追加する既存テストケースを選択してください",
    matchOnDescription: true,
    matchOnDetail: true
  });
}

export async function pickRemoveCaseFromPlanItem(
  items: RemoveCaseFromPlanQuickPickItem[]
): Promise<RemoveCaseFromPlanQuickPickItem | undefined> {
  return vscode.window.showQuickPick(items, {
    placeHolder: "この計画から外すテストケースを選択してください",
    matchOnDescription: true,
    matchOnDetail: true
  });
}

export async function pickExecutionItem(
  items: ExecutionQuickPickItem[]
): Promise<ExecutionQuickPickItem | undefined> {
  return vscode.window.showQuickPick(items, {
    placeHolder: "テストケースの実行結果を更新する Test Run を選択してください",
    matchOnDescription: true,
    matchOnDetail: true
  });
}

export async function pickCaseHistoryDiffPair(
  history: Parameters<typeof buildCaseHistoryDiffQuickPickItems>[0]
): Promise<CaseHistoryDiffPair | undefined> {
  const items = buildCaseHistoryDiffQuickPickItems(history);
  if (items.length === 0) {
    void vscode.window.showInformationMessage("Selectable case history was not found.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "差分表示する履歴ペアを選択してください",
    matchOnDescription: true,
    matchOnDetail: true
  });
  return picked?.pair;
}

export function serializeExistingCaseToPlanItem(item: ExistingCaseToPlanQuickPickItem): {
  label: string;
  description: string;
  detail: string;
  caseId: number;
  summary: string;
  plans: Array<{ id: number; name: string }>;
} {
  return {
    label: item.label,
    description: item.description,
    detail: item.detail,
    caseId: item.entry.caseId,
    summary: item.entry.summary,
    plans: item.entry.plans.map((plan) => ({ id: plan.id, name: plan.name }))
  };
}

export function serializeRemoveCaseFromPlanItem(item: RemoveCaseFromPlanQuickPickItem): {
  label: string;
  description: string;
  detail: string;
  planId: number;
  caseId: number;
  summary: string;
} {
  return {
    label: item.label,
    description: item.description,
    detail: item.detail,
    planId: item.plan.id,
    caseId: item.caseRef.id,
    summary: item.caseRef.summary
  };
}

export function serializeExecutionItem(item: ExecutionQuickPickItem): {
  label: string;
  description: string | undefined;
  detail: string | undefined;
  executionId: number;
  runId: number;
  caseId: number;
  status: string;
} {
  return {
    label: item.label,
    description: item.description,
    detail: item.detail,
    executionId: item.execution.id,
    runId: item.execution.runId,
    caseId: item.execution.caseId,
    status: item.execution.status
  };
}
