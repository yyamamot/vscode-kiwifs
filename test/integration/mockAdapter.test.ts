import { describe, expect, it } from "vitest";
import { createKiwiHarness } from "../harness/createKiwiHarness";
import { MockFileAdapter } from "../../src/adapter/mockFileAdapter";
import { deriveVersionToken } from "../../src/domain/versionToken";

describe("mockAdapter", () => {
  it("lists plans, cases, and updates case history", async () => {
    const harness = await createKiwiHarness();
    await harness.seedPlans([{ id: 100, name: "Regression" }]);
    await harness.seedCaseDocument({
      id: 501,
      planId: 100,
      summary: "Login works",
      priority: "P1",
      category: "Functional",
      status: "CONFIRMED",
      components: ["Auth"],
      tags: ["smoke"],
      notes: "None.",
      text: "# Login succeeds.\n\n1. Open login page"
    });
    await harness.seedPlanCases(100, [501]);
    await harness.seedCaseHistory(501, [
      {
        historyId: 10,
        historyDate: "2026-04-05T00:00:00.000Z"
      }
    ]);

    const adapter = new MockFileAdapter(harness.statePath);
    const config = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };

    const plans = await adapter.listPlans(config);
    expect(plans).toHaveLength(1);
    const cases = await adapter.listPlanCases(config, 100);
    expect(cases[0]?.id).toBe(501);
    const historyBefore = await adapter.getCaseHistory(config, 501);
    expect(deriveVersionToken(historyBefore)).toBe("history_id:10");

    const currentBody = await adapter.getCaseBody(config, 501, 100);
    expect(currentBody.text).toContain("Open login page");

    const current = await adapter.getCase(config, 501);
    await adapter.updateCaseText(config, 501, `${current.text}\n2. Sign in`);

    const historyAfter = await adapter.getCaseHistory(config, 501);
    expect(historyAfter[0]?.historyId).toBe(11);
    const updated = await adapter.getCase(config, 501);
    expect(updated.summary).toBe("Login works");
    expect(updated.text).toContain("2. Sign in");
  });

  it("supports remote change simulation", async () => {
    const harness = await createKiwiHarness();
    await harness.seedPlans([{ id: 100, name: "Regression" }]);
    await harness.seedCaseDocument({
      id: 501,
      planId: 100,
      summary: "Login works",
      priority: "P1",
      category: "Functional",
      status: "CONFIRMED",
      components: ["Auth"],
      tags: ["smoke"],
      notes: "None.",
      text: "# Login succeeds.\n\n1. Open login page"
    });
    await harness.seedCaseHistory(501, [
      {
        historyDate: "2026-04-05T00:00:00.000Z"
      }
    ]);

    await harness.simulateRemoteChange(501, (current) => ({
      ...current,
      text: `${current.text}\n2. Remote change`
    }));

    const adapter = new MockFileAdapter(harness.statePath);
    const updated = await adapter.getCase(
      {
        baseUrl: harness.baseUrl,
        username: "admin",
        password: "admin"
      },
      501
    );
    expect(updated.summary).toBe("Login works");
    expect(updated.text).toContain("2. Remote change");
  });

  it("updates case metadata independently from body text", async () => {
    const harness = await createKiwiHarness();
    await harness.seedPlans([{ id: 100, name: "Regression" }]);
    await harness.seedCaseDocument({
      id: 501,
      planId: 100,
      summary: "Login works",
      priority: "P1",
      category: "Functional",
      status: "CONFIRMED",
      components: ["Auth"],
      tags: ["smoke"],
      notes: "None.",
      text: "# Login succeeds.\n\n1. Open login page"
    });
    await harness.seedCaseHistory(501, [
      {
        historyId: 10,
        historyDate: "2026-04-05T00:00:00.000Z"
      }
    ]);

    const adapter = new MockFileAdapter(harness.statePath);
    const config = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };

    const updated = await adapter.updateCaseMetadata(config, 501, {
      summary: "Login updated",
      priority: "P2",
      status: "IDLE",
      tags: ["regression", "smoke"]
    });

    expect(updated.summary).toBe("Login updated");
    expect(updated.priority).toBe("P2");
    expect(updated.status).toBe("IDLE");
    expect(updated.tags).toEqual(["regression", "smoke"]);
    expect(updated.text).toContain("Open login page");

    const historyAfter = await adapter.getCaseHistory(config, 501);
    expect(historyAfter[0]?.historyId).toBe(11);
  });

  it("lists metadata option values", async () => {
    const harness = await createKiwiHarness();
    const adapter = new MockFileAdapter(harness.statePath);
    const config = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };

    await expect(adapter.listCaseStatuses(config)).resolves.toEqual(["CONFIRMED", "IDLE", "DRAFT"]);
    await expect(adapter.listPriorities(config)).resolves.toEqual(["P1", "P2", "P3"]);
  });

  it("creates a new case and links it to the plan", async () => {
    const harness = await createKiwiHarness();
    await harness.seedPlans([{ id: 100, name: "Regression" }]);
    await harness.seedCaseDocument({
      id: 501,
      planId: 100,
      summary: "Login works",
      priority: "P1",
      category: "Functional",
      status: "CONFIRMED",
      components: ["Auth"],
      tags: ["smoke"],
      notes: "None.",
      text: "# Login succeeds.\n\n1. Open login page"
    });
    await harness.seedPlanCases(100, [501]);

    const adapter = new MockFileAdapter(harness.statePath);
    const config = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };

    const created = await adapter.createCase(config, 100, {
      summary: "Login copied",
      priority: "P2",
      status: "IDLE",
      tags: ["regression", "smoke"],
      text: "# Purpose\n\n# Steps\n\n# Expected Result\n"
    });

    expect(created.id).toBe(502);
    expect(created.planId).toBe(100);
    expect(created.summary).toBe("Login copied");
    expect(created.priority).toBe("P2");
    expect(created.status).toBe("IDLE");
    expect(created.tags).toEqual(["regression", "smoke"]);
    expect(created.text).toContain("# Purpose");
    expect(created.components).toEqual([]);
    expect(created.notes).toBe("");

    const state = await harness.readState();
    expect(state.planCases["100"]).toEqual([501, 502]);
    expect(state.histories["502"]?.[0]?.historyChangeReason).toBe("create");
  });

  it("links an existing case to a plan without duplicating it", async () => {
    const harness = await createKiwiHarness();
    await harness.seedPlans([
      { id: 100, name: "Regression" },
      { id: 200, name: "Secondary" }
    ]);
    await harness.seedCaseDocument({
      id: 501,
      planId: 100,
      summary: "Login works",
      priority: "P1",
      category: "Functional",
      status: "CONFIRMED",
      components: ["Auth"],
      tags: ["smoke"],
      notes: "None.",
      text: "# Login succeeds.\n\n1. Open login page"
    });
    await harness.seedPlanCases(100, [501]);
    await harness.seedPlanCases(200, []);

    const adapter = new MockFileAdapter(harness.statePath);
    const config = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };

    await adapter.addCaseToPlan(config, 200, 501);
    await adapter.addCaseToPlan(config, 200, 501);

    const state = await harness.readState();
    expect(state.planCases["100"]).toEqual([501]);
    expect(state.planCases["200"]).toEqual([501]);
  });

  it("unlinks a case from one plan without changing other plan links", async () => {
    const harness = await createKiwiHarness();
    await harness.seedPlans([
      { id: 100, name: "Regression" },
      { id: 200, name: "Secondary" }
    ]);
    await harness.seedCaseDocument({
      id: 501,
      planId: 100,
      summary: "Login works",
      priority: "P1",
      category: "Functional",
      status: "CONFIRMED",
      components: ["Auth"],
      tags: ["smoke"],
      notes: "None.",
      text: "# Login succeeds.\n\n1. Open login page"
    });
    await harness.seedPlanCases(100, [501]);
    await harness.seedPlanCases(200, [501]);

    const adapter = new MockFileAdapter(harness.statePath);
    const config = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };

    await adapter.removeCaseFromPlan(config, 100, 501);
    await adapter.removeCaseFromPlan(config, 100, 501);

    const state = await harness.readState();
    expect(state.planCases["100"]).toEqual([]);
    expect(state.planCases["200"]).toEqual([501]);
    expect(state.cases["501"]?.summary).toBe("Login works");
  });

  it("fails existing case plan linking for missing plan or case", async () => {
    const harness = await createKiwiHarness();
    await harness.seedPlans([{ id: 100, name: "Regression" }]);
    await harness.seedPlanCases(100, []);
    const adapter = new MockFileAdapter(harness.statePath);
    const config = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };

    await expect(adapter.addCaseToPlan(config, 999, 501)).rejects.toThrow(/Plan 999/);
    await expect(adapter.addCaseToPlan(config, 100, 501)).rejects.toThrow(/Case 501/);
    await expect(adapter.removeCaseFromPlan(config, 999, 501)).rejects.toThrow(/Plan 999/);
    await expect(adapter.removeCaseFromPlan(config, 100, 501)).rejects.toThrow(/Case 501/);
  });

  it("lists and updates case execution results", async () => {
    const harness = await createKiwiHarness();
    await harness.seedPlans([{ id: 100, name: "Regression" }]);
    await harness.seedTestRuns([
      { id: 300, summary: "Regression run", build: "2026.04", planId: 100 },
      { id: 301, summary: "Nightly run", build: "2026.04-nightly", planId: 200 }
    ]);
    await harness.seedCaseDocument({
      id: 501,
      planId: 100,
      summary: "Login works",
      priority: "P1",
      category: "Functional",
      status: "CONFIRMED",
      components: ["Auth"],
      tags: ["smoke"],
      notes: "None.",
      text: "# Login succeeds.\n\n1. Open login page"
    });
    await harness.seedExecutions([
      {
        id: 9001,
        runId: 300,
        runSummary: "Regression run",
        caseId: 501,
        caseSummary: "Login works",
        build: "2026.04",
        status: "IDLE",
        comment: ""
      },
      {
        id: 9002,
        runId: 301,
        runSummary: "Nightly run",
        caseId: 501,
        caseSummary: "Login works",
        build: "2026.04-nightly",
        status: "FAILED",
        comment: "Known issue"
      }
    ]);

    const adapter = new MockFileAdapter(harness.statePath);
    const config = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };

    await expect(adapter.listExecutionStatuses(config)).resolves.toEqual([
      { id: 1, name: "IDLE" },
      { id: 2, name: "PASSED" },
      { id: 3, name: "FAILED" },
      { id: 4, name: "BLOCKED" }
    ]);
    const executions = await adapter.listCaseExecutions(config, 501);
    expect(executions.map((item) => item.id)).toEqual([9001, 9002]);
    await expect(adapter.listTestRuns(config)).resolves.toEqual([
      { id: 300, summary: "Regression run", build: "2026.04", planId: 100 },
      { id: 301, summary: "Nightly run", build: "2026.04-nightly", planId: 200 }
    ]);
    const runExecutions = await adapter.listRunExecutions(config, 300);
    expect(runExecutions.map((item) => item.id)).toEqual([9001]);

    const updated = await adapter.updateExecution(config, 9001, {
      status: "PASSED",
      comment: "Verified in VS Code"
    });
    expect(updated.status).toBe("PASSED");
    expect(updated.comment).toBe("Verified in VS Code");
  });

  it("creates test runs and adds cases to them", async () => {
    const harness = await createKiwiHarness();
    await harness.seedPlans([{ id: 100, name: "Regression" }]);
    await harness.seedBuildsForPlan(100, [{ id: 1, name: "2026.04-phase3" }]);
    await harness.seedCaseDocument({
      id: 501,
      planId: 100,
      summary: "Login works",
      priority: "P1",
      category: "Functional",
      status: "CONFIRMED",
      components: [],
      tags: [],
      notes: "",
      text: "Body"
    });
    await harness.seedTestRuns([]);
    await harness.seedExecutions([]);

    const adapter = new MockFileAdapter(harness.statePath);
    const config = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };

    await expect(adapter.listBuildsForPlan(config, 100)).resolves.toEqual([
      { id: 1, name: "2026.04-phase3" }
    ]);

    const created = await adapter.createTestRun(config, {
      summary: "Created from test",
      planId: 100,
      buildId: 1,
      manager: "admin"
    });
    expect(created).toMatchObject({
      id: 1,
      summary: "Created from test",
      build: "2026.04-phase3",
      planId: 100,
      manager: "admin"
    });

    await adapter.addCaseToRun(config, created.id, 501);
    await adapter.addCaseToRun(config, created.id, 501);

    const runExecutions = await adapter.listRunExecutions(config, created.id);
    expect(runExecutions).toHaveLength(1);
    expect(runExecutions[0]).toMatchObject({
      runId: 1,
      caseId: 501,
      caseSummary: "Login works",
      status: "IDLE"
    });
  });

  it("lists and adds attachments", async () => {
    const harness = await createKiwiHarness();
    await harness.seedPlans([{ id: 100, name: "Regression" }]);
    await harness.seedCaseDocument({
      id: 501,
      planId: 100,
      summary: "Login works",
      priority: "P1",
      category: "Functional",
      status: "CONFIRMED",
      components: [],
      tags: [],
      notes: "",
      text: "Body"
    });
    await harness.seedCaseAttachments(501, [
      {
        filename: "existing.txt",
        size: 5,
        downloadUrl: "mock://default/attachments/501/existing.txt"
      }
    ]);

    const adapter = new MockFileAdapter(harness.statePath);
    const config = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };

    const before = await adapter.listCaseAttachments(config, 501);
    expect(before).toHaveLength(1);
    const existingContent = await adapter.getCaseAttachmentContent(
      config,
      "mock://default/attachments/501/existing.txt"
    );
    expect(Buffer.from(existingContent.body).toString("utf8")).toBe("");
    await adapter.addCaseAttachment(config, 501, "new.txt", Buffer.from("hello").toString("base64"));
    const after = await adapter.listCaseAttachments(config, 501);
    expect(after.map((item) => item.filename)).toContain("new.txt");
    const added = await adapter.getCaseAttachmentContent(
      config,
      "mock://default/attachments/501/new.txt"
    );
    expect(Buffer.from(added.body).toString("utf8")).toBe("hello");
  });
});
