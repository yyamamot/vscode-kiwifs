import { describe, expect, it } from "vitest";
import {
  buildExistingCaseToPlanEntries,
  buildExistingCaseToPlanQuickPickItems
} from "../../src/extension/buildExistingCaseToPlanQuickPickItems";

describe("buildExistingCaseToPlanQuickPickItems", () => {
  const planCases = [
    {
      plan: { id: 100, name: "Regression" },
      cases: [
        { id: 501, summary: "Login works" },
        { id: 502, summary: "Password reset works" }
      ]
    },
    {
      plan: { id: 200, name: "Secondary" },
      cases: [
        { id: 502, summary: "Password reset works" },
        { id: 601, summary: "Login load time" }
      ]
    }
  ];

  it("excludes cases already present in the target plan", () => {
    const entries = buildExistingCaseToPlanEntries(planCases, 100, "login");

    expect(entries.map((entry) => entry.caseId)).toEqual([601]);
  });

  it("dedupes cases by id and keeps source plan labels", () => {
    const entries = buildExistingCaseToPlanEntries(planCases, 300, "password");
    const items = buildExistingCaseToPlanQuickPickItems(entries);

    expect(items).toEqual([
      {
        label: "502 - Password reset works",
        description: "plans: 100 - Regression, 200 - Secondary",
        detail: "この計画に追加する既存テストケース",
        entry: {
          caseId: 502,
          summary: "Password reset works",
          plans: [
            { id: 100, name: "Regression" },
            { id: 200, name: "Secondary" }
          ]
        }
      }
    ]);
  });

  it("prioritizes exact numeric case id matches", () => {
    const entries = buildExistingCaseToPlanEntries(planCases, 300, "601");

    expect(entries.map((entry) => entry.caseId)).toEqual([601]);
  });
});
