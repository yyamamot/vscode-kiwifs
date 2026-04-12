import { describe, expect, it } from "vitest";
import {
  buildCaseSearchQuickPickItems,
  filterCaseSearchMatches
} from "../../src/extension/buildCaseSearchQuickPickItems";

describe("buildCaseSearchQuickPickItems", () => {
  const plans = [
    {
      plan: { id: 100, name: "Regression" },
      cases: [
        { id: 501, summary: "Login works" },
        { id: 502, summary: "Password reset works" }
      ]
    },
    {
      plan: { id: 200, name: "Performance" },
      cases: [{ id: 601, summary: "Login load time" }]
    }
  ];

  it("prioritizes exact numeric case id matches", () => {
    const matches = filterCaseSearchMatches(plans, "601");

    expect(matches.map((item) => item.caseRef.id)).toEqual([601]);
  });

  it("matches summary by case-insensitive partial text", () => {
    const matches = filterCaseSearchMatches(plans, "login");

    expect(matches.map((item) => item.caseRef.id)).toEqual([501, 601]);
  });

  it("builds quick pick items with case and plan labels", () => {
    const items = buildCaseSearchQuickPickItems(filterCaseSearchMatches(plans, "login"));

    expect(items).toEqual([
      {
        label: "501 - Login works",
        description: "100 - Regression",
        detail: "Login works",
        plan: { id: 100, name: "Regression" },
        caseRef: { id: 501, summary: "Login works" }
      },
      {
        label: "601 - Login load time",
        description: "200 - Performance",
        detail: "Login load time",
        plan: { id: 200, name: "Performance" },
        caseRef: { id: 601, summary: "Login load time" }
      }
    ]);
  });
});
