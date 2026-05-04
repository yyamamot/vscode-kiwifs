import { describe, expect, it } from "vitest";
import { toTreeItemActionSurfaceState } from "../../src/extension/treeItemActionSurfaceModel";

describe("treeItemActionSurfaceModel", () => {
  it("builds plan action surface items without direct remote write", () => {
    const state = toTreeItemActionSurfaceState({
      kind: "plan",
      planId: 100,
      planName: "Regression",
      planText: "Regression plan description"
    }, undefined, {
      caseCount: 4,
      testRunCount: 2,
      localMirrorSummary: "ローカルの変更 1 / Kiwi側の変更 0 / 競合 0"
    });

    expect(state.title).toBe("Test Plan Actions");
    expect(state.overview?.rows).toEqual([
      { label: "Test Plan ID", value: "100" },
      { label: "Name", value: "Regression" },
      { label: "Description", value: "Regression plan description" },
      { label: "Child Test Cases", value: "4" },
      { label: "Test Runs", value: "2" },
      { label: "Local Mirror", value: "ローカルの変更 1 / Kiwi側の変更 0 / 競合 0" }
    ]);
    expect(state.items.map((item) => item.command)).toEqual([
      "kiwi.openPlanInBrowser",
      "kiwi.createCase",
      "kiwi.addExistingCaseToPlan",
      "kiwi.filterCases",
      "kiwi.openTestRunDashboard",
      "kiwi.filterTestRuns",
      "kiwi.downloadPlanToLocalMirror",
      "kiwi.comparePlanLocalMirror",
      "kiwi.removeCaseFromPlanFromPlan"
    ]);
    expect(state.items.find((item) => item.command === "kiwi.createCase")?.category).toBe("cases");
    expect(state.items.find((item) => item.command === "kiwi.openTestRunDashboard")?.category).toBe("execution");
    expect(state.items.some((item) => item.command === "kiwi.showPlanInfo")).toBe(false);
    expect(state.items.some((item) => item.command === "kiwi.uploadPlanLocalMirror")).toBe(false);
  });

  it("builds case action surface items by category", () => {
    const state = toTreeItemActionSurfaceState({
      kind: "case",
      planId: 100,
      planName: "Regression",
      caseId: 501,
      caseSummary: "Login works"
    }, {
      status: "CONFIRMED",
      priority: "P1",
      category: "Functional",
      tags: ["smoke"]
    });

    expect(state.title).toBe("Test Case Actions");
    expect(state.overview?.rows).toEqual([
      { label: "Test Case ID", value: "501" },
      { label: "Overview", value: "Login works" },
      { label: "Test Plan", value: "100 - Regression" },
      { label: "Status", value: "CONFIRMED" },
      { label: "Priority", value: "P1" },
      { label: "Category", value: "Functional" },
      { label: "Tags", value: "smoke" }
    ]);
    expect(state.items.some((item) => item.command === "kiwi.showCaseInfo")).toBe(false);
    expect(state.items.some((item) => item.command === "kiwi.checkCaseFreshness")).toBe(false);
    expect(state.items.some((item) => item.command === "kiwi.showCaseDiff")).toBe(false);
    expect(state.items.some((item) => item.command === "kiwi.compareLocalMirror")).toBe(false);
    expect(state.items.find((item) => item.command === "kiwi.editCaseMetadata")?.category).toBe("edit");
    expect(state.items.find((item) => item.command === "kiwi.duplicateCase")?.category).toBe("create");
    expect(state.items.find((item) => item.command === "kiwi.recordCaseExecutionResult")).toMatchObject({
      category: "execution",
      label: "Update Test Execution Result"
    });
    expect(state.items.find((item) => item.command === "kiwi.manageCaseExecutionsAcrossRuns")).toMatchObject({
      category: "execution",
      label: "Manage Test Executions"
    });
    expect(state.items.map((item) => item.command)).toContain("kiwi.openCaseAttachmentInEditor");
    expect(state.items.map((item) => item.command)).toContain("kiwi.manageCaseExecutionsAcrossRuns");
    expect(state.items.map((item) => item.command)).toContain("kiwi.revealLocalMirror");
    expect(state.items.some((item) => item.command === "kiwi.uploadLocalMirror")).toBe(false);
  });
});
