import { type KiwiPlansTreeNode } from "../KiwiPlansTreeDataProvider";

export function regressionPlanNode(planId = 100): Extract<KiwiPlansTreeNode, { kind: "plan" }> {
  return {
    kind: "plan",
    plan: {
      id: planId,
      name: planId === 100 ? "Regression" : "Secondary"
    }
  };
}

export function regressionCaseNode(args: {
  planId?: number;
  planName?: string;
  caseId?: number;
  summary?: string;
} = {}): Extract<KiwiPlansTreeNode, { kind: "case" }> {
  const planId = args.planId ?? 100;
  return {
    kind: "case",
    plan: {
      id: planId,
      name: args.planName ?? (planId === 100 ? "Regression" : "Secondary")
    },
    caseRef: {
      id: args.caseId ?? 501,
      summary: args.summary ?? "Login works"
    }
  };
}
