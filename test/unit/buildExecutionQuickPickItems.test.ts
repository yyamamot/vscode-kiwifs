import { describe, expect, it } from "vitest";
import { buildExecutionQuickPickItems } from "../../src/extension/buildExecutionQuickPickItems";

describe("buildExecutionQuickPickItems", () => {
  it("shows run, execution, status, and build fields", () => {
    const items = buildExecutionQuickPickItems([
      {
        id: 9002,
        runId: 301,
        runSummary: "Nightly",
        caseId: 501,
        caseSummary: "Login works",
        build: "2026.04",
        status: "FAILED"
      }
    ]);

    expect(items[0]?.label).toBe("301 - Nightly");
    expect(items[0]?.description).toBe("execution 9002 / FAILED");
    expect(items[0]?.detail).toBe("build: 2026.04");
    expect(items[0]?.execution.id).toBe(9002);
  });
});
