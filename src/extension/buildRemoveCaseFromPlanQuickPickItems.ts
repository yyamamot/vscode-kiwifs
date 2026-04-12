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
  cases: PlanCaseRef[]
): RemoveCaseFromPlanQuickPickItem[] {
  return [...cases]
    .sort((left, right) => left.id - right.id)
    .map((caseRef) => ({
      label: `${caseRef.id} - ${caseRef.summary}`,
      description: `${plan.id} - ${plan.name}`,
      detail: "この計画から外すテストケース",
      plan,
      caseRef
    }));
}
