import { describe, expect, it } from "vitest";
import {
  filterCaseRefsByQuery,
  hasAnyCaseFilterCondition,
  normalizeCaseFilterFormState
} from "../../src/extension/caseFilter";

const options = {
  plans: [
    { id: 100, name: "Regression" },
    { id: 200, name: "Smoke" }
  ],
  statuses: ["CONFIRMED", "IDLE"],
  priorities: ["P1", "P2"]
};

describe("caseFilter", () => {
  it("normalizes form state and tags", () => {
    const filter = normalizeCaseFilterFormState(
      {
        query: " Login ",
        planId: "100",
        status: "CONFIRMED",
        priority: "P1",
        tagsInput: " Smoke, regression, smoke "
      },
      options
    );

    expect(filter).toEqual({
      query: "Login",
      planId: 100,
      status: "CONFIRMED",
      priority: "P1",
      tags: ["regression", "smoke"]
    });
    expect(hasAnyCaseFilterCondition(filter)).toBe(true);
  });

  it("rejects empty filters", () => {
    const filter = normalizeCaseFilterFormState(
      {
        query: " ",
        planId: "",
        status: "",
        priority: "",
        tagsInput: " "
      },
      options
    );

    expect(hasAnyCaseFilterCondition(filter)).toBe(false);
  });

  it("prioritizes exact numeric case id matches", () => {
    const matches = filterCaseRefsByQuery(
      [
        { id: 601, summary: "Login 602" },
        { id: 602, summary: "Password" }
      ],
      "602"
    );

    expect(matches.map((item) => item.id)).toEqual([602, 601]);
  });

  it("matches summary case-insensitively", () => {
    const matches = filterCaseRefsByQuery(
      [
        { id: 601, summary: "Login works" },
        { id: 602, summary: "Password reset" }
      ],
      "LOGIN"
    );

    expect(matches.map((item) => item.id)).toEqual([601]);
  });

  it("validates selected plan status and priority", () => {
    expect(() =>
      normalizeCaseFilterFormState(
        { query: "", planId: "999", status: "", priority: "", tagsInput: "" },
        options
      )
    ).toThrow(/Plan/);
    expect(() =>
      normalizeCaseFilterFormState(
        { query: "", planId: "", status: "UNKNOWN", priority: "", tagsInput: "" },
        options
      )
    ).toThrow(/Status/);
    expect(() =>
      normalizeCaseFilterFormState(
        { query: "", planId: "", status: "", priority: "P9", tagsInput: "" },
        options
      )
    ).toThrow(/Priority/);
  });
});
