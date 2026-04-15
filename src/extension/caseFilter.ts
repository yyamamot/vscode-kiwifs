import { KiwiAdapter } from "../adapter/types";
import { KiwiError } from "../domain/errors";
import { KiwiCase, KiwiCaseSearchMode, KiwiConfig, KiwiPlan, PlanCaseRef } from "../types";
import { buildCaseSearchMatchesFromResults } from "./buildCaseSearchQuickPickItems";

export interface CaseFilterFormState {
  query: string;
  queryTarget: KiwiCaseSearchMode;
  planId: string;
  status: string;
  priority: string;
  tagsInput: string;
}

export interface CaseFilterOptions {
  plans: KiwiPlan[];
  statuses: string[];
  priorities: string[];
}

export interface CaseFilterResult {
  plan: KiwiPlan;
  caseRef: PlanCaseRef;
  status: string;
  priority: string;
  tags: string[];
  textSnippet?: string;
}

export interface NormalizedCaseFilter {
  query: string;
  queryTarget: KiwiCaseSearchMode;
  planId?: number;
  status?: string;
  priority?: string;
  tags: string[];
}

export async function filterCasesWithMetadata(args: {
  adapter: KiwiAdapter;
  config: KiwiConfig;
  formState: CaseFilterFormState;
  options: CaseFilterOptions;
}): Promise<CaseFilterResult[]> {
  const filter = normalizeCaseFilterFormState(args.formState, args.options);
  if (!hasAnyCaseFilterCondition(filter)) {
    throw new KiwiError("ValidationFailed", "検索条件を入力してください。");
  }

  const plans =
    filter.planId !== undefined
      ? args.options.plans.filter((plan) => plan.id === filter.planId)
      : args.options.plans;
  const planCases = await Promise.all(
    plans.map(async (plan) => ({
      plan,
      cases: await args.adapter.listPlanCases(args.config, plan.id)
    }))
  );
  const matchedPlanCases =
    filter.query && filter.queryTarget === "body"
      ? buildCaseSearchMatchesFromResults(
          planCases,
          await args.adapter.searchCases(args.config, {
            query: filter.query,
            mode: "body"
          })
        )
      : planCases.flatMap((entry) =>
          filterCaseRefsByQuery(entry.cases, filter.query).map((caseRef) => ({
            plan: entry.plan,
            caseRef,
            textSnippet: undefined
          }))
        );

  const results: CaseFilterResult[] = [];
  for (const match of matchedPlanCases) {
    const caseData = await args.adapter.getCase(args.config, match.caseRef.id, match.plan.id);
    if (matchesMetadata(caseData, filter)) {
      results.push({
        plan: match.plan,
        caseRef: {
          id: caseData.id,
          summary: caseData.summary
        },
        status: caseData.status,
        priority: caseData.priority,
        tags: [...caseData.tags].sort((left, right) => left.localeCompare(right)),
        textSnippet: match.textSnippet
      });
    }
  }

  return results.sort((left, right) => {
    if (left.plan.id !== right.plan.id) {
      return left.plan.id - right.plan.id;
    }
    return left.caseRef.id - right.caseRef.id;
  });
}

export function normalizeCaseFilterFormState(
  formState: CaseFilterFormState,
  options: CaseFilterOptions
): NormalizedCaseFilter {
  const query = formState.query.trim();
  const planId = formState.planId.trim() ? Number.parseInt(formState.planId, 10) : undefined;
  if (formState.planId.trim() && !options.plans.some((plan) => plan.id === planId)) {
    throw new KiwiError("ValidationFailed", `Plan '${formState.planId}' is invalid.`);
  }
  if (formState.status && !options.statuses.includes(formState.status)) {
    throw new KiwiError("ValidationFailed", `Status '${formState.status}' is invalid.`);
  }
  if (formState.priority && !options.priorities.includes(formState.priority)) {
    throw new KiwiError("ValidationFailed", `Priority '${formState.priority}' is invalid.`);
  }

  return {
    query,
    queryTarget: formState.queryTarget,
    planId,
    status: formState.status || undefined,
    priority: formState.priority || undefined,
    tags: normalizeFilterTags(formState.tagsInput)
  };
}

export function hasAnyCaseFilterCondition(filter: NormalizedCaseFilter): boolean {
  return Boolean(
    filter.query ||
      filter.planId !== undefined ||
      filter.status ||
      filter.priority ||
      filter.tags.length > 0
  );
}

export function filterCaseRefsByQuery(caseRefs: PlanCaseRef[], query: string): PlanCaseRef[] {
  if (!query) {
    return [...caseRefs].sort((left, right) => left.id - right.id);
  }

  const normalizedQuery = query.toLocaleLowerCase();
  const numericQuery = /^\d+$/.test(query) ? Number(query) : undefined;
  const exactIdMatches: PlanCaseRef[] = [];
  const summaryMatches: PlanCaseRef[] = [];

  for (const caseRef of caseRefs) {
    if (numericQuery !== undefined && caseRef.id === numericQuery) {
      exactIdMatches.push(caseRef);
      continue;
    }
    if (caseRef.summary.toLocaleLowerCase().includes(normalizedQuery)) {
      summaryMatches.push(caseRef);
    }
  }

  return [...exactIdMatches, ...summaryMatches];
}

function matchesMetadata(caseData: KiwiCase, filter: NormalizedCaseFilter): boolean {
  if (filter.status && caseData.status !== filter.status) {
    return false;
  }
  if (filter.priority && caseData.priority !== filter.priority) {
    return false;
  }
  if (filter.tags.length > 0) {
    const caseTags = new Set(caseData.tags.map((tag) => tag.trim().toLocaleLowerCase()));
    return filter.tags.every((tag) => caseTags.has(tag));
  }
  return true;
}

function normalizeFilterTags(tagsInput: string): string[] {
  return [
    ...new Set(
      tagsInput
        .split(",")
        .map((tag) => tag.trim().toLocaleLowerCase())
        .filter(Boolean)
    )
  ].sort((left, right) => left.localeCompare(right));
}
