import { describe, expect, it } from "vitest";
import {
  buildCaseExecutionBoardAddQuickPickItems,
  buildRegisteredCaseExecutionBoardGroups
} from "../../src/extension/buildCaseExecutionBoardState";

describe("buildCaseExecutionBoardState", () => {
  it("groups only registered executions by plan", () => {
    const groups = buildRegisteredCaseExecutionBoardGroups({
      plans: [
        { id: 100, name: "TP1-x86" },
        { id: 200, name: "TP2-arm64" }
      ],
      runs: [
        { id: 300, summary: "TR100 test1", build: "2026.04", planId: 100 },
        { id: 301, summary: "TR101 test2", build: "2026.04", planId: 100 },
        { id: 400, summary: "TR102 test1", build: "2026.04-arm", planId: 200 }
      ],
      executions: [
        {
          id: 9001,
          runId: 300,
          runSummary: "TR100 test1",
          caseId: 501,
          caseSummary: "Login works",
          build: "2026.04",
          status: "PASSED",
          comment: "done"
        }
      ]
    });

    expect(groups).toEqual([
      {
        planId: 100,
        planName: "TP1-x86",
        rows: [
          {
            runId: 300,
            runSummary: "TR100 test1",
            build: "2026.04",
            executionId: 9001,
            status: "PASSED",
            comment: "",
            isSaving: false
          }
        ]
      }
    ]);
  });

  it("builds add candidates from only unregistered runs", () => {
    const items = buildCaseExecutionBoardAddQuickPickItems({
      plans: [
        { id: 100, name: "TP1-x86" },
        { id: 200, name: "TP2-arm64" }
      ],
      runs: [
        { id: 300, summary: "TR100 test1", build: "2026.04", planId: 100 },
        { id: 301, summary: "TR101 test2", build: "2026.04", planId: 100 },
        { id: 400, summary: "TR102 test1", build: "2026.04-arm", planId: 200 }
      ],
      executions: [
        {
          id: 9001,
          runId: 300,
          runSummary: "TR100 test1",
          caseId: 501,
          caseSummary: "Login works",
          build: "2026.04",
          status: "PASSED",
          comment: "done"
        }
      ]
    });

    expect(items.map((item) => ({
      label: item.label,
      description: item.description,
      detail: item.detail
    }))).toEqual([
      {
        label: "TR301 TR101 test2",
        description: "100 - TP1-x86",
        detail: "build: 2026.04"
      },
      {
        label: "TR400 TR102 test1",
        description: "200 - TP2-arm64",
        detail: "build: 2026.04-arm"
      }
    ]);
  });
});
