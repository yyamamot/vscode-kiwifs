import { describe, expect, it } from "vitest";
import {
  buildCaseSearchMatchesFromResults,
  buildCaseSearchQuickPickItems,
  filterCaseSearchMatches,
  paginateCaseSearchItems,
  parseCaseSearchQuery
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
        itemType: "case",
        plan: { id: 100, name: "Regression" },
        caseRef: { id: 501, summary: "Login works" }
      },
      {
        label: "601 - Login load time",
        description: "200 - Performance",
        detail: "Login load time",
        itemType: "case",
        plan: { id: 200, name: "Performance" },
        caseRef: { id: 601, summary: "Login load time" }
      }
    ]);
  });

  it("parses body search prefixes", () => {
    expect(parseCaseSearchQuery("body: checkout")).toEqual({
      mode: "body",
      query: "checkout"
    });
    expect(parseCaseSearchQuery("本文: ログイン")).toEqual({
      mode: "body",
      query: "ログイン"
    });
    expect(parseCaseSearchQuery("Login")).toEqual({
      mode: "id-summary",
      query: "Login"
    });
  });

  it("intersects body search results with plan listings", () => {
    const matches = buildCaseSearchMatchesFromResults(plans, [
      { caseId: 601, summary: "Remote summary", textSnippet: "body match" },
      { caseId: 999, summary: "Missing from plan" }
    ]);

    expect(matches).toEqual([
      {
        plan: { id: 200, name: "Performance" },
        caseRef: { id: 601, summary: "Remote summary" },
        textSnippet: "body match"
      }
    ]);
  });

  it("paginates visible search results", () => {
    const page = paginateCaseSearchItems([1, 2, 3, 4], 2, 2);

    expect(page).toEqual({
      visibleItems: [1, 2],
      totalCount: 4,
      visibleCount: 2,
      hasMore: true
    });
    expect(paginateCaseSearchItems([1, 2, 3], 4, 2)).toEqual({
      visibleItems: [1, 2, 3],
      totalCount: 3,
      visibleCount: 3,
      hasMore: false
    });
  });
});
