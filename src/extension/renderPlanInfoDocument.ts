import { KiwiPlan } from "../types";

type PlanInfoDocumentInput = {
  plan: KiwiPlan;
};

export function renderPlanInfoDocument(input: PlanInfoDocumentInput): string {
  const { plan } = input;

  return [
    `# ${plan.name}`,
    "",
    `- id: ${plan.id}`,
    "",
    "## Text",
    "",
    plan.text?.trim() ? plan.text : "_(empty)_",
    ""
  ].join("\n");
}
