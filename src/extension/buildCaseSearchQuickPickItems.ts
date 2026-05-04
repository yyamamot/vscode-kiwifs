import { KiwiCaseSearchResult, KiwiPlan, PlanCaseRef } from "../types";

export const CASE_SEARCH_PAGE_SIZE = 50;

export type ParsedCaseSearchQuery = {
  mode: "id-summary" | "body";
  query: string;
};

export type CaseSearchMatch = {
  plan: KiwiPlan;
  caseRef: PlanCaseRef;
  textSnippet?: string;
};

export type CaseSearchQuickPickItem = {
  label: string;
  description: string;
  detail: string;
  itemType: "case" | "more";
  plan: KiwiPlan;
  caseRef: PlanCaseRef;
};

export type CaseSearchVisiblePage<T> = {
  visibleItems: T[];
  totalCount: number;
  visibleCount: number;
  hasMore: boolean;
};

export function parseCaseSearchQuery(rawQuery: string): ParsedCaseSearchQuery {
  const query = rawQuery.trim();
  const bodyPrefixes = ["body:", "本文:"];
  for (const prefix of bodyPrefixes) {
    if (query.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
      return {
        mode: "body",
        query: query.slice(prefix.length).trim()
      };
    }
  }
  return {
    mode: "id-summary",
    query
  };
}

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

export function buildCaseSearchMatchesFromResults(
  plans: Array<{
    plan: KiwiPlan;
    cases: PlanCaseRef[];
  }>,
  searchResults: KiwiCaseSearchResult[]
): CaseSearchMatch[] {
  const resultsByCaseId = new Map(searchResults.map((result) => [result.caseId, result]));
  const matches: CaseSearchMatch[] = [];
  for (const entry of plans) {
    for (const caseRef of entry.cases) {
      const result = resultsByCaseId.get(caseRef.id);
      if (result) {
        matches.push({
          plan: entry.plan,
          caseRef: {
            id: caseRef.id,
            summary: result.summary || caseRef.summary
          },
          textSnippet: result.textSnippet
        });
      }
    }
  }
  return matches.sort((left, right) => {
    if (left.plan.id !== right.plan.id) {
      return left.plan.id - right.plan.id;
    }
    return left.caseRef.id - right.caseRef.id;
  });
}

export function paginateCaseSearchItems<T>(
  items: T[],
  visibleCount: number,
  pageSize = CASE_SEARCH_PAGE_SIZE
): CaseSearchVisiblePage<T> {
  const nextVisibleCount = Math.min(Math.max(visibleCount, pageSize), items.length);
  return {
    visibleItems: items.slice(0, nextVisibleCount),
    totalCount: items.length,
    visibleCount: nextVisibleCount,
    hasMore: nextVisibleCount < items.length
  };
}

export function buildCaseSearchQuickPickItems(
  matches: CaseSearchMatch[],
  input: { totalCount?: number; hasMore?: boolean; moreLabel?: string; moreDetail?: string } = {}
): CaseSearchQuickPickItem[] {
  const items: CaseSearchQuickPickItem[] = matches.map(({ plan, caseRef, textSnippet }) => ({
    label: `${caseRef.id} - ${caseRef.summary}`,
    description: `${plan.id} - ${plan.name}`,
    detail: textSnippet ?? caseRef.summary,
    itemType: "case",
    plan,
    caseRef
  }));
  if (input.hasMore) {
    items.push({
      label: input.moreLabel ?? "Show More",
      description: `${matches.length} / ${input.totalCount ?? matches.length}`,
      detail: input.moreDetail ?? "Show more search results.",
      itemType: "more",
      plan: { id: 0, name: "" },
      caseRef: { id: 0, summary: "" }
    });
  }
  return items;
}
