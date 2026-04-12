import { KiwiPlan, PlanCaseRef } from "../types";

export type CaseSearchMatch = {
  plan: KiwiPlan;
  caseRef: PlanCaseRef;
};

export type CaseSearchQuickPickItem = {
  label: string;
  description: string;
  detail: string;
  plan: KiwiPlan;
  caseRef: PlanCaseRef;
};

export function filterCaseSearchMatches(
  plans: Array<{
    plan: KiwiPlan;
    cases: PlanCaseRef[];
  }>,
  rawQuery: string
): CaseSearchMatch[] {
  const query = rawQuery.trim();
  if (!query) {
    return [];
  }

  const normalizedQuery = query.toLocaleLowerCase();
  const numericQuery = /^\d+$/.test(query) ? Number(query) : undefined;
  const exactIdMatches: CaseSearchMatch[] = [];
  const summaryMatches: CaseSearchMatch[] = [];

  for (const entry of plans) {
    for (const caseRef of entry.cases) {
      if (numericQuery !== undefined && caseRef.id === numericQuery) {
        exactIdMatches.push({ plan: entry.plan, caseRef });
        continue;
      }

      if (caseRef.summary.toLocaleLowerCase().includes(normalizedQuery)) {
        summaryMatches.push({ plan: entry.plan, caseRef });
      }
    }
  }

  return [...exactIdMatches, ...summaryMatches];
}

export function buildCaseSearchQuickPickItems(
  matches: CaseSearchMatch[]
): CaseSearchQuickPickItem[] {
  return matches.map(({ plan, caseRef }) => ({
    label: `${caseRef.id} - ${caseRef.summary}`,
    description: `${plan.id} - ${plan.name}`,
    detail: caseRef.summary,
    plan,
    caseRef
  }));
}
