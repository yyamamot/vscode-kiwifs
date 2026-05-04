import { KiwiPlan, PlanCaseRef } from "../types";

export type RemoveCaseFromPlanQuickPickItem = {
  label: string;
  description: string;
  detail: string;
  plan: KiwiPlan;
  caseRef: PlanCaseRef;
};

export function buildRemoveCaseFromPlanQuickPickItems(
  plan: KiwiPlan,
  cases: PlanCaseRef[],
  labels: { detail?: string } = {}
): RemoveCaseFromPlanQuickPickItem[] {
  return [...cases]
    .sort((left, right) => left.id - right.id)
    .map((caseRef) => ({
      label: `${caseRef.id} - ${caseRef.summary}`,
      description: `${plan.id} - ${plan.name}`,
      detail: labels.detail ?? "Test case to remove from this plan",
      plan,
      caseRef
    }));
}
