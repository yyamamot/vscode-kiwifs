import { describe, expect, it } from "vitest";
import {
  diffExecutionResultPatch,
  toExecutionResultFormState
} from "../../src/domain/executionResultForm";
import { KiwiCaseExecution, KiwiExecutionStatus } from "../../src/types";

describe("executionResultForm", () => {
  const execution: KiwiCaseExecution = {
    id: 9001,
    runId: 300,
    runSummary: "Regression run",
    caseId: 501,
    caseSummary: "Login works",
    build: "2026.04",
    status: "IDLE",
    comment: "old"
  };
  const statuses: KiwiExecutionStatus[] = [
    { id: 1, name: "IDLE" },
    { id: 2, name: "PASSED" },
    { id: 3, name: "FAILED" }
  ];

  it("builds an initial form state from an execution", () => {
    expect(toExecutionResultFormState(execution)).toEqual({
      status: "IDLE",
      comment: ""
    });
  });

  it("creates a changed-only patch for status and comment", () => {
    expect(
      diffExecutionResultPatch(
        execution,
        {
          status: "PASSED",
          comment: " verified "
        },
        statuses
      )
    ).toEqual({
      status: "PASSED",
      comment: "verified"
    });
  });

  it("omits unchanged status and empty comment", () => {
    expect(
      diffExecutionResultPatch(
        execution,
        {
          status: "IDLE",
          comment: " "
        },
        statuses
      )
    ).toEqual({});
  });

  it("rejects unavailable statuses", () => {
    expect(() =>
      diffExecutionResultPatch(
        execution,
        {
          status: "UNKNOWN",
          comment: ""
        },
        statuses
      )
    ).toThrow(/UNKNOWN/);
  });
});
