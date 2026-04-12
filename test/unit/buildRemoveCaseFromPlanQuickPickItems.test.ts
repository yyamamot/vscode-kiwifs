import { describe, expect, it } from "vitest";
import { buildRemoveCaseFromPlanQuickPickItems } from "../../src/extension/buildRemoveCaseFromPlanQuickPickItems";

describe("buildRemoveCaseFromPlanQuickPickItems", () => {
  it("builds remove candidates from current plan cases", () => {
    const items = buildRemoveCaseFromPlanQuickPickItems(
      { id: 100, name: "Regression" },
      [
        { id: 502, summary: "Password reset works" },
        { id: 501, summary: "Login works" }
      ]
    );

    expect(items).toEqual([
      {
        label: "501 - Login works",
        description: "100 - Regression",
        detail: "この計画から外すテストケース",
        plan: { id: 100, name: "Regression" },
        caseRef: { id: 501, summary: "Login works" }
      },
      {
        label: "502 - Password reset works",
        description: "100 - Regression",
        detail: "この計画から外すテストケース",
        plan: { id: 100, name: "Regression" },
        caseRef: { id: 502, summary: "Password reset works" }
      }
    ]);
  });

  it("returns no candidates for an empty plan", () => {
    const items = buildRemoveCaseFromPlanQuickPickItems({ id: 100, name: "Regression" }, []);

    expect(items).toEqual([]);
  });
});
