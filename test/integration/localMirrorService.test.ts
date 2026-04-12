import * as assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "vitest";
import { MockFileAdapter } from "../../src/adapter/mockFileAdapter";
import { LocalMirrorService } from "../../src/extension/localMirrorService";
import { createKiwiHarness } from "../harness/createKiwiHarness";
import { KiwiConfig } from "../../src/types";
import { KiwiError } from "../../src/domain/errors";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("LocalMirrorService", () => {
  it("downloads, compares, and uploads local mirror changes", async () => {
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
      text: "# Purpose\n\nLogin succeeds."
    });
    await harness.seedCaseHistory(501, [{ historyId: 10, historyDate: "2026-04-05T00:00:00.000Z" }]);

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "kiwifs-mirror-int-"));
    tempDirs.push(workspaceRoot);
    const config: KiwiConfig = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };
    const service = new LocalMirrorService(async () => ({
      adapter: new MockFileAdapter(harness.statePath),
      config
    }), workspaceRoot);
    const target = {
      plan: { id: 100, name: "Regression" },
      caseRef: { id: 501, summary: "Login works" }
    };

    const downloaded = await service.downloadCase(target);
    assert.match(await readFile(downloaded.localPath, "utf8"), /Login succeeds/);

    await writeFile(downloaded.localPath, "# Purpose\n\nLogin succeeds.\n\nEdited locally.\n", "utf8");
    const compare = await service.compareCase(target);
    assert.equal(compare.status, "modified locally");
    assert.match(compare.localBody, /Edited locally/);

    await service.uploadCase(target);
    const state = await harness.readState();
    assert.match(state.cases["501"]?.text ?? "", /Edited locally/);
  });

  it("detects remote changes and rejects upload", async () => {
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
      text: "Original"
    });
    await harness.seedCaseHistory(501, [{ historyId: 10, historyDate: "2026-04-05T00:00:00.000Z" }]);

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "kiwifs-mirror-int-"));
    tempDirs.push(workspaceRoot);
    const service = new LocalMirrorService(async () => ({
      adapter: new MockFileAdapter(harness.statePath),
      config: {
        baseUrl: harness.baseUrl,
        username: "admin",
        password: "admin"
      }
    }), workspaceRoot);
    const target = {
      plan: { id: 100, name: "Regression" },
      caseRef: { id: 501, summary: "Login works" }
    };

    const downloaded = await service.downloadCase(target);
    await writeFile(downloaded.localPath, "Local change", "utf8");
    await harness.simulateRemoteChange(501, (current) => ({
      ...current,
      text: "Remote change"
    }));

    const compare = await service.compareCase(target);
    assert.equal(compare.status, "conflict");
    await assert.rejects(
      async () => {
        await service.uploadCase(target);
      },
      (error) => error instanceof KiwiError && error.code === "ConflictDetected"
    );
  });

  it("downloads plan cases in bulk and skips locally modified mirrors", async () => {
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
      text: "Login body"
    });
    await harness.seedCaseDocument({
      id: 502,
      planId: 100,
      summary: "Password reset works",
      priority: "P2",
      category: "Functional",
      status: "CONFIRMED",
      components: [],
      tags: [],
      notes: "",
      text: "Reset body"
    });
    await harness.seedPlanCases(100, [501, 502]);
    await harness.seedCaseHistory(501, [{ historyId: 10, historyDate: "2026-04-05T00:00:00.000Z" }]);
    await harness.seedCaseHistory(502, [{ historyId: 20, historyDate: "2026-04-05T00:00:00.000Z" }]);

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "kiwifs-mirror-int-"));
    tempDirs.push(workspaceRoot);
    const config: KiwiConfig = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };
    const service = new LocalMirrorService(async () => ({
      adapter: new MockFileAdapter(harness.statePath),
      config
    }), workspaceRoot);

    const first = await service.downloadPlanCases({ id: 100, name: "Regression" });
    assert.deepEqual(first, { downloaded: 2, overwritten: 0, skipped: 0, failed: 0 });

    const loginMirror = path.join(
      workspaceRoot,
      ".kiwi-mirror",
      "plans",
      "100 - Regression",
      "cases",
      "501 - Login works.md"
    );
    await writeFile(loginMirror, "Locally modified", "utf8");

    const second = await service.downloadPlanCases({ id: 100, name: "Regression" });
    assert.deepEqual(second, { downloaded: 1, overwritten: 0, skipped: 1, failed: 0 });
    assert.equal(await readFile(loginMirror, "utf8"), "Locally modified");
  });

  it("force-downloads plan cases in bulk and counts overwritten mirrors", async () => {
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
      text: "Login body"
    });
    await harness.seedCaseDocument({
      id: 502,
      planId: 100,
      summary: "Password reset works",
      priority: "P2",
      category: "Functional",
      status: "CONFIRMED",
      components: [],
      tags: [],
      notes: "",
      text: "Reset body"
    });
    await harness.seedPlanCases(100, [501, 502]);
    await harness.seedCaseHistory(501, [{ historyId: 10, historyDate: "2026-04-05T00:00:00.000Z" }]);
    await harness.seedCaseHistory(502, [{ historyId: 20, historyDate: "2026-04-05T00:00:00.000Z" }]);

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "kiwifs-mirror-int-"));
    tempDirs.push(workspaceRoot);
    const config: KiwiConfig = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };
    const service = new LocalMirrorService(async () => ({
      adapter: new MockFileAdapter(harness.statePath),
      config
    }), workspaceRoot);

    await service.downloadPlanCases({ id: 100, name: "Regression" });

    const loginMirror = path.join(
      workspaceRoot,
      ".kiwi-mirror",
      "plans",
      "100 - Regression",
      "cases",
      "501 - Login works.md"
    );
    await writeFile(loginMirror, "Locally modified", "utf8");

    const forced = await service.downloadPlanCases({ id: 100, name: "Regression" }, { force: true });
    assert.deepEqual(forced, { downloaded: 1, overwritten: 1, skipped: 0, failed: 0 });
    assert.equal(await readFile(loginMirror, "utf8"), "Login body");
  });

  it("force-downloads over modified local mirrors for case sync only", async () => {
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
      text: "Remote body"
    });
    await harness.seedCaseHistory(501, [{ historyId: 10, historyDate: "2026-04-05T00:00:00.000Z" }]);

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "kiwifs-mirror-int-"));
    tempDirs.push(workspaceRoot);
    const config: KiwiConfig = {
      baseUrl: harness.baseUrl,
      username: "admin",
      password: "admin"
    };
    const service = new LocalMirrorService(async () => ({
      adapter: new MockFileAdapter(harness.statePath),
      config
    }), workspaceRoot);
    const target = {
      plan: { id: 100, name: "Regression" },
      caseRef: { id: 501, summary: "Login works" }
    };

    const downloaded = await service.downloadCase(target);
    await writeFile(downloaded.localPath, "Local only", "utf8");

    await assert.rejects(
      async () => {
        await service.downloadCase(target);
      },
      (error) => error instanceof KiwiError && error.code === "ValidationFailed"
    );

    const forced = await service.downloadCase(target, { force: true });
    assert.equal(await readFile(forced.localPath, "utf8"), "Remote body");
  });

  it("reports plan mirror statuses for multiple cases", async () => {
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
      text: "Original login"
    });
    await harness.seedCaseDocument({
      id: 502,
      planId: 100,
      summary: "Password reset works",
      priority: "P2",
      category: "Functional",
      status: "CONFIRMED",
      components: [],
      tags: [],
      notes: "",
      text: "Original reset"
    });
    await harness.seedPlanCases(100, [501, 502]);
    await harness.seedCaseHistory(501, [{ historyId: 10, historyDate: "2026-04-05T00:00:00.000Z" }]);
    await harness.seedCaseHistory(502, [{ historyId: 20, historyDate: "2026-04-05T00:00:00.000Z" }]);

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "kiwifs-mirror-int-"));
    tempDirs.push(workspaceRoot);
    const service = new LocalMirrorService(async () => ({
      adapter: new MockFileAdapter(harness.statePath),
      config: {
        baseUrl: harness.baseUrl,
        username: "admin",
        password: "admin"
      }
    }), workspaceRoot);

    await service.downloadCase({
      plan: { id: 100, name: "Regression" },
      caseRef: { id: 501, summary: "Login works" }
    });
    const loginMirror = path.join(
      workspaceRoot,
      ".kiwi-mirror",
      "plans",
      "100 - Regression",
      "cases",
      "501 - Login works.md"
    );
    await writeFile(loginMirror, "Locally modified", "utf8");

    const rows = await service.getPlanMirrorStatus({ id: 100, name: "Regression" });
    assert.deepEqual(
      rows.map((row) => ({ caseId: row.caseId, status: row.status })),
      [
        { caseId: 501, status: "modified locally" },
        { caseId: 502, status: "missing locally" }
      ]
    );
    assert.match(rows[0]?.localPath ?? "", /501 - Login works\.md$/);
    assert.match(rows[1]?.localPath ?? "", /502 - Password reset works\.md$/);
  });
});
