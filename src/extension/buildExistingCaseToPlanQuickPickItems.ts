import { KiwiPlan, PlanCaseRef } from "../types";

export type ExistingCaseToPlanEntry = {
  caseId: number;
  summary: string;
  plans: KiwiPlan[];
};

export type ExistingCaseToPlanQuickPickItem = {
  label: string;
  description: string;
  detail: string;
  entry: ExistingCaseToPlanEntry;
};

export function buildExistingCaseToPlanEntries(
  planCases: Array<{
    plan: KiwiPlan;
    cases: PlanCaseRef[];
  }>,
  targetPlanId: number,
  rawQuery: string
): ExistingCaseToPlanEntry[] {
  const query = rawQuery.trim();
  if (!query) {
    return [];
  }

  const targetCaseIds = new Set(
    planCases.find((entry) => entry.plan.id === targetPlanId)?.cases.map((caseRef) => caseRef.id) ?? []
  );
  const byCaseId = new Map<number, ExistingCaseToPlanEntry>();

  for (const entry of planCases) {
    for (const caseRef of entry.cases) {
      if (targetCaseIds.has(caseRef.id)) {
        continue;
      }
      if (!matchesQuery(caseRef, query)) {
        continue;
      }

      const current = byCaseId.get(caseRef.id);
      if (current) {
        if (!current.plans.some((plan) => plan.id === entry.plan.id)) {
          current.plans.push(entry.plan);
          current.plans.sort((left, right) => left.id - right.id);
        }
        continue;
      }
      byCaseId.set(caseRef.id, {
        caseId: caseRef.id,
        summary: caseRef.summary,
        plans: [entry.plan]
      });
    }
  }

  const entries = [...byCaseId.values()];
  return entries.sort((left, right) => {
    const leftExact = isExactIdMatch(left.caseId, query);
    const rightExact = isExactIdMatch(right.caseId, query);
    if (leftExact !== rightExact) {
      return leftExact ? -1 : 1;
    }
    return left.caseId - right.caseId;
  });
}

export function buildExistingCaseToPlanQuickPickItems(
  entries: ExistingCaseToPlanEntry[]
): ExistingCaseToPlanQuickPickItem[] {
  return entries.map((entry) => ({
    label: `${entry.caseId} - ${entry.summary}`,
    description: `plans: ${entry.plans.map((plan) => `${plan.id} - ${plan.name}`).join(", ")}`,
    detail: "この計画に追加する既存テストケース",
    entry
  }));
}

function matchesQuery(caseRef: PlanCaseRef, query: string): boolean {
  if (isExactIdMatch(caseRef.id, query)) {
    return true;
  }
  return caseRef.summary.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function isExactIdMatch(caseId: number, query: string): boolean {
  return /^\d+$/.test(query) && caseId === Number(query);
}
