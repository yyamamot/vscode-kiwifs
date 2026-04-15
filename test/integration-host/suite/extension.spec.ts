import * as assert from "node:assert/strict";
import * as path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import * as vscode from "vscode";
import { createKiwiHarness, KiwiHarness } from "../../harness/createKiwiHarness";
import type { KiwiPlansTreeSnapshotNode } from "../../../src/extension/KiwiPlansTreeDataProvider";

describe("extension host", () => {
  let harness: KiwiHarness;

  before(async function () {
    this.timeout(30000);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      await rm(path.join(workspaceRoot, ".kiwi-mirror"), { recursive: true, force: true });
    }
    harness = await createKiwiHarness();
    await harness.seedPlans([
      { id: 100, name: "Regression" },
      { id: 200, name: "Secondary" }
    ]);
    await harness.seedBuildsForPlan(100, [
      { id: 1, name: "2026.04" },
      { id: 2, name: "2026.04-phase3" }
    ]);
    await harness.seedBuildsForPlan(200, [{ id: 3, name: "2026.04-nightly" }]);
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
      text: "# Purpose\n\nLogin succeeds.\n\n# Steps\n\n1. Open login page"
    });
    await harness.seedCaseDocument({
      id: 502,
      planId: 100,
      summary: "Password reset works",
      priority: "P2",
      category: "Functional",
      status: "CONFIRMED",
      components: ["Auth"],
      tags: ["regression"],
      notes: "None.",
      text: "Password reset text"
    });
    await harness.seedCaseDocument({
      id: 601,
      planId: 200,
      summary: "Existing reusable case",
      priority: "P3",
      category: "Functional",
      status: "IDLE",
      components: ["Shared"],
      tags: ["reusable"],
      notes: "None.",
      text: "Reusable text"
    });
    await harness.seedPlanCases(100, [501, 502]);
    await harness.seedPlanCases(200, [601]);
    await harness.seedCaseTemplates([
      {
        id: 10,
        name: "Regression Template",
        text: "# Template Purpose\n\nUse this body from Kiwi template."
      }
    ]);
    await harness.seedCaseHistory(501, [
      {
        historyId: 11,
        historyDate: "2026-04-06T00:00:00.000Z",
        historyType: "~",
        historyChangeReason: "latest body",
        text: "# Login works\n\nOne-step newer body."
      },
      {
        historyId: 10,
        historyDate: "2026-04-05T00:00:00.000Z",
        historyType: "~",
        historyChangeReason: "initial body",
        text: "# Login works\n\nHistorical body."
      },
      {
        historyDate: "2026-04-04T00:00:00.000Z",
        historyType: "+",
        historyChangeReason: "created"
      }
    ]);
    await harness.seedCaseHistory(502, [
      {
        historyId: 20,
        historyDate: "2026-04-05T00:00:00.000Z"
      }
    ]);
    await harness.seedCaseHistory(601, [
      {
        historyId: 30,
        historyDate: "2026-04-05T00:00:00.000Z"
      }
    ]);
    await harness.seedCaseAttachments(501, [
      {
        filename: "attachment",
        size: 4,
        downloadUrl: `${harness.baseUrl.replace(/\/$/, "")}/attachments/501/diagram.svg`,
        contentType: "image/svg+xml",
        contentFilename: "diagram.svg",
        bodyBase64: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "utf8").toString("base64")
      },
      {
        filename: "existing.txt",
        size: 5,
        downloadUrl: `${harness.baseUrl.replace(/\/$/, "")}/attachments/501/existing.txt`,
        contentType: "text/plain; charset=utf-8",
        bodyBase64: Buffer.from("hello", "utf8").toString("base64")
      }
    ]);
    await harness.seedTestRuns([
      {
        id: 300,
        summary: "Regression run",
        build: "2026.04",
        planId: 100
      },
      {
        id: 301,
        summary: "Nightly run",
        build: "2026.04-nightly",
        planId: 200
      },
      {
        id: 302,
        summary: "Secondary pending run",
        build: "2026.04-nightly",
        planId: 200
      }
    ]);
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

    process.env.KIWI_MOCK_STATE_PATH = harness.statePath;
    await vscode.workspace.getConfiguration("kiwi").update(
      "baseUrl",
      harness.baseUrl,
      vscode.ConfigurationTarget.Global
    );
    const extension = getKiwifsExtension();
    assert.ok(extension);
    await extension.activate();
  });

  after(async function () {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      await rm(path.join(workspaceRoot, ".kiwi-mirror"), { recursive: true, force: true });
    }
  });

  it("lists plans and opens case documents", async function () {
    this.timeout(20000);
    const plans = await vscode.workspace.fs.readDirectory(vscode.Uri.parse("kiwi:/plans/"));
    assert.equal(plans[0]?.[0], "100 - Regression");

    const cases = await vscode.workspace.fs.readDirectory(
      vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/")
    );
    assert.equal(cases[0]?.[0], "501 - Login works.md");

    const documentBytes = await vscode.workspace.fs.readFile(
      vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md")
    );
    const documentText = Buffer.from(documentBytes).toString("utf8");
    assert.match(documentText, /# Purpose/);
    assert.doesNotMatch(documentText, /version_token:/);
  });

  it("searches cases by id and summary and opens the selected case document", async function () {
    this.timeout(20000);

    try {
      const byId = await vscode.commands.executeCommand<{
        items: Array<{ caseId: number; label: string }>;
        opened?: string;
      }>("kiwi.__test.searchCases", "501", 501);
      assert.equal(byId?.items[0]?.caseId, 501);
      assert.ok((byId?.opened ?? "").includes("501"));
      assert.ok((byId?.opened ?? "").includes("Login"));

      const bySummary = await vscode.commands.executeCommand<{
        items: Array<{ caseId: number; label: string; itemType: string }>;
        opened?: string;
      }>("kiwi.__test.searchCases", "password", 502);
      assert.equal(bySummary?.items[0]?.caseId, 502);
      assert.ok((bySummary?.opened ?? "").includes("502"));
      assert.ok((bySummary?.opened ?? "").includes("Password"));

      const opened = await waitForDocumentContent(
        vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/502 - Password reset works.md"),
        /Password reset text/
      );
      assert.match(opened.getText(), /Password reset text/);

      const byBody = await vscode.commands.executeCommand<{
        items: Array<{ caseId: number; label: string; detail: string; itemType: string }>;
        opened?: string;
      }>("kiwi.__test.searchCases", "body:reset text", 502);
      assert.equal(byBody?.items[0]?.caseId, 502);
      assert.match(byBody?.items[0]?.detail ?? "", /reset text/);
      assert.ok((byBody?.opened ?? "").includes("502"));
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
  });

  it("returns an empty result when no cases match the search query", async function () {
    this.timeout(20000);

    const result = await vscode.commands.executeCommand<Array<{ caseId: number }>>(
      "kiwi.__test.searchCases",
      "does-not-exist"
    );
    assert.deepEqual(result, []);
  });

  it("does not treat view title context as a search query", async function () {
    this.timeout(20000);

    const result = await vscode.commands.executeCommand<undefined>(
      "kiwi.searchCases",
      {
        kind: "case",
        plan: { id: 100, name: "Regression" },
        caseRef: { id: 501, summary: "Login works" }
      },
      -1
    );
    assert.equal(result, undefined);
  });

  it("filters cases through the Webview filter controller and opens a selected result", async function () {
    this.timeout(20000);

    try {
      const title = await vscode.commands.executeCommand<string>("kiwi.__test.filterCases");
      assert.equal(title, "テストケースを探す");
      const html = await vscode.commands.executeCommand<string>("kiwi.__test.getCaseFilterHtml");
      assert.match(html ?? "", /<h1>テストケースを探す<\/h1>/);

      const initialState = await vscode.commands.executeCommand<{
        formState: { query: string; queryTarget: string; planId: string; status: string; priority: string; tagsInput: string };
        options: {
          plans: Array<{ id: number; name: string }>;
          statuses: string[];
          priorities: string[];
        };
        results: Array<{ caseRef: { id: number } }>;
      }>("kiwi.__test.getCaseFilterState");
      assert.equal(initialState?.formState.query, "");
      assert.ok(initialState?.options.plans.some((plan) => plan.id === 100));
      assert.ok(initialState?.options.statuses.includes("CONFIRMED"));
      assert.ok(initialState?.options.priorities.includes("P1"));
      assert.deepEqual(initialState?.results, []);

      const results = await vscode.commands.executeCommand<
        Array<{
          plan: { id: number; name: string };
          caseRef: { id: number; summary: string };
          status: string;
          priority: string;
          tags: string[];
        }>
      >("kiwi.__test.submitCaseFilter", {
        query: "",
        queryTarget: "id-summary",
        planId: "100",
        status: "CONFIRMED",
        priority: "P1",
        tagsInput: "SMOKE"
      });
      assert.equal(results?.length, 1);
      assert.equal(results?.[0]?.caseRef.id, 501);
      assert.equal(results?.[0]?.status, "CONFIRMED");
      assert.deepEqual(results?.[0]?.tags, ["smoke"]);

      const bodyResults = await vscode.commands.executeCommand<
        Array<{
          caseRef: { id: number; summary: string };
          textSnippet?: string;
        }>
      >("kiwi.__test.submitCaseFilter", {
        query: "reset text",
        queryTarget: "body",
        planId: "",
        status: "",
        priority: "",
        tagsInput: ""
      });
      assert.equal(bodyResults?.length, 1);
      assert.equal(bodyResults?.[0]?.caseRef.id, 502);
      assert.match(bodyResults?.[0]?.textSnippet ?? "", /reset text/);

      const opened = await vscode.commands.executeCommand<string>(
        "kiwi.__test.openCaseFilterResult",
        502
      );
      assert.ok(opened?.includes("502"));
      await waitForDocumentContent(
        vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/502 - Password reset works.md"),
        /Password reset text/
      );

      await harness.seedCaseDocument({
        id: 511,
        planId: 100,
        summary: "Bulk target one",
        priority: "P1",
        category: "Functional",
        status: "CONFIRMED",
        components: [],
        tags: ["smoke"],
        notes: "",
        text: "Bulk target one"
      });
      await harness.seedCaseDocument({
        id: 512,
        planId: 100,
        summary: "Bulk target two",
        priority: "P2",
        category: "Functional",
        status: "CONFIRMED",
        components: [],
        tags: ["regression"],
        notes: "",
        text: "Bulk target two"
      });
      await harness.seedPlanCases(100, [501, 502, 511, 512]);

      const bulkResults = await vscode.commands.executeCommand<
        Array<{ caseRef: { id: number } }>
      >("kiwi.__test.submitCaseFilter", {
        query: "Bulk target",
        queryTarget: "id-summary",
        planId: "100",
        status: "",
        priority: "",
        tagsInput: ""
      });
      assert.deepEqual(bulkResults?.map((item) => item.caseRef.id), [511, 512]);

      const toggled = await vscode.commands.executeCommand<{
        selectedCaseIds: number[];
        selectedCount: number;
      }>("kiwi.__test.toggleCaseFilterSelection", 511, true);
      assert.deepEqual(toggled?.selectedCaseIds, [511]);
      assert.equal(toggled?.selectedCount, 1);

      await vscode.commands.executeCommand("kiwi.__test.toggleCaseFilterSelection", 512, true);
      const afterMultiSelect = await vscode.commands.executeCommand<{
        selectedCaseIds: number[];
        selectedCount: number;
      }>("kiwi.__test.getCaseFilterState");
      assert.deepEqual(afterMultiSelect?.selectedCaseIds, [511, 512]);
      assert.equal(afterMultiSelect?.selectedCount, 2);

      const bulkStatus = await vscode.commands.executeCommand<{ updated: number; failed: number }>(
        "kiwi.__test.bulkUpdateCaseFilterStatus",
        [511, 512],
        "IDLE"
      );
      assert.deepEqual(bulkStatus, { updated: 2, failed: 0 });

      const bulkAddTags = await vscode.commands.executeCommand<{ updated: number; failed: number }>(
        "kiwi.__test.bulkAddCaseFilterTags",
        [511, 512],
        "bulk, smoke"
      );
      assert.deepEqual(bulkAddTags, { updated: 2, failed: 0 });

      const bulkRemoveTags = await vscode.commands.executeCommand<{ updated: number; failed: number }>(
        "kiwi.__test.bulkRemoveCaseFilterTags",
        [511, 512],
        "smoke"
      );
      assert.deepEqual(bulkRemoveTags, { updated: 2, failed: 0 });

      const bulkState = await harness.readState();
      assert.equal(bulkState.cases["511"]?.status, "IDLE");
      assert.equal(bulkState.cases["512"]?.status, "IDLE");
      assert.deepEqual(bulkState.cases["511"]?.tags, ["bulk"]);
      assert.deepEqual(bulkState.cases["512"]?.tags, ["bulk", "regression"]);

      const emptyResults = await vscode.commands.executeCommand<
        Array<{ caseRef: { id: number } }>
      >("kiwi.__test.submitCaseFilter", {
        query: "does-not-exist",
        queryTarget: "id-summary",
        planId: "",
        status: "",
        priority: "",
        tagsInput: ""
      });
      assert.deepEqual(emptyResults, []);

      await assert.rejects(
        async () => {
          await vscode.commands.executeCommand("kiwi.__test.submitCaseFilter", {
            query: "",
            queryTarget: "id-summary",
            planId: "",
            status: "",
            priority: "",
            tagsInput: ""
          });
        },
        /検索条件を入力してください/
      );
      await harness.seedPlanCases(100, [501, 502]);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
  });

  it("adds an existing case to a plan from a plan target", async function () {
    this.timeout(20000);

    const result = await vscode.commands.executeCommand<{
      planId: number;
      caseId: number;
      summary: string;
    }>("kiwi.__test.addExistingCaseToPlan", "Existing", 601, 100);
    assert.equal(result?.planId, 100);
    assert.equal(result?.caseId, 601);
    assert.equal(result?.summary, "Existing reusable case");

    const state = await harness.readState();
    assert.deepEqual(state.planCases["100"], [501, 502, 601]);
    assert.deepEqual(state.planCases["200"], [601]);

    const snapshot = await vscode.commands.executeCommand<KiwiPlansTreeSnapshotNode[]>(
      "kiwi.__test.getPlanTreeSnapshot"
    );
    assert.ok(
      snapshot?.[0]?.children?.some((node) => node.label === "601 - Existing reusable case.md")
    );

    const excluded = await vscode.commands.executeCommand<Array<{ caseId: number }>>(
      "kiwi.__test.addExistingCaseToPlan",
      "Existing",
      undefined,
      100
    );
    assert.deepEqual(excluded, []);
  });

  it("removes a case from a plan without closing an opened case document", async function () {
    this.timeout(20000);

    try {
      const uri = vscode.Uri.parse(
        "kiwi:/plans/100 - Regression/cases/501 - Login works.md"
      );
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);

      const cancelled = await vscode.commands.executeCommand<{
        planId: number;
        caseId: number;
        cancelled: boolean;
      }>("kiwi.__test.removeCaseFromPlan", {
        selectionCaseId: 501,
        confirmed: false,
        targetPlanId: 100
      });
      assert.equal(cancelled?.cancelled, true);
      let state = await harness.readState();
      assert.ok(state.planCases["100"]?.includes(501));

      const result = await vscode.commands.executeCommand<{
        planId: number;
        caseId: number;
        summary: string;
      }>("kiwi.__test.removeCaseFromPlan", {
        selectionCaseId: 501,
        confirmed: true,
        targetPlanId: 100
      });
      assert.equal(result?.planId, 100);
      assert.equal(result?.caseId, 501);
      assert.equal(result?.summary, "Login works");

      state = await harness.readState();
      assert.deepEqual(state.planCases["100"], [502, 601]);
      assert.ok(state.cases["501"]);
      assert.ok(vscode.workspace.textDocuments.some((item) => item.uri.toString() === uri.toString()));

      const snapshot = await vscode.commands.executeCommand<KiwiPlansTreeSnapshotNode[]>(
        "kiwi.__test.getPlanTreeSnapshot"
      );
      assert.ok(
        !snapshot?.[0]?.children?.some((node) => node.label === "501 - Login works.md")
      );
    } finally {
      await harness.seedPlanCases(100, [501, 502, 601]);
      await vscode.commands.executeCommand("kiwi.refreshPlans");
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
  });

  it("deletes a case from case context and closes opened case documents", async function () {
    this.timeout(20000);

    const uri = vscode.Uri.parse(
      "kiwi:/plans/100 - Regression/cases/501 - Login works.md"
    );
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand("type", { text: "\nLocal draft before delete." });
      assert.equal(document.isDirty, true);

      const cancelled = await vscode.commands.executeCommand<{
        caseId: number;
        cancelled: boolean;
      }>("kiwi.__test.deleteCase", {
        confirmed: false,
        targetPlanId: 100,
        targetCaseId: 501,
        targetCaseSummary: "Login works"
      });
      assert.equal(cancelled?.cancelled, true);
      let state = await harness.readState();
      assert.ok(state.cases["501"]);
      assert.equal(hasTabForUri(uri.toString()), true);

      const result = await vscode.commands.executeCommand<{
        caseId: number;
        summary: string;
      }>("kiwi.__test.deleteCase", {
        confirmed: true,
        targetPlanId: 100,
        targetCaseId: 501,
        targetCaseSummary: "Login works"
      });
      assert.equal(result?.caseId, 501);
      assert.equal(result?.summary, "Login works");

      state = await harness.readState();
      assert.equal(state.cases["501"], undefined);
      assert.equal(state.planCases["100"]?.includes(501), false);
      assert.equal(state.histories["501"], undefined);
      assert.equal(state.attachments["501"], undefined);
      await waitForTabState(uri.toString(), false);

      const snapshot = await vscode.commands.executeCommand<KiwiPlansTreeSnapshotNode[]>(
        "kiwi.__test.getPlanTreeSnapshot"
      );
      assert.ok(
        !snapshot?.[0]?.children?.some((node) => node.label === "501 - Login works.md")
      );
    } finally {
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
        text: "# Purpose\n\nLogin succeeds.\n\n# Steps\n\n1. Open login page"
      });
      await harness.seedPlanCases(100, [501, 502, 601]);
      await harness.seedCaseHistory(501, [
        {
          historyId: 11,
          historyDate: "2026-04-06T00:00:00.000Z",
          historyType: "~",
          historyChangeReason: "latest body",
          text: "# Login works\n\nOne-step newer body."
        },
        {
          historyId: 10,
          historyDate: "2026-04-05T00:00:00.000Z",
          historyType: "~",
          historyChangeReason: "initial body",
          text: "# Login works\n\nHistorical body."
        }
      ]);
      await harness.seedCaseAttachments(501, [
        {
          filename: "attachment",
          size: 4,
          downloadUrl: `${harness.baseUrl.replace(/\/$/, "")}/attachments/501/diagram.svg`,
          contentType: "image/svg+xml",
          contentFilename: "diagram.svg",
          bodyBase64: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "utf8").toString("base64")
        },
        {
          filename: "existing.txt",
          size: 5,
          downloadUrl: `${harness.baseUrl.replace(/\/$/, "")}/attachments/501/existing.txt`,
          contentType: "text/plain; charset=utf-8",
          bodyBase64: Buffer.from("hello", "utf8").toString("base64")
        }
      ]);
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
      await vscode.commands.executeCommand("kiwi.refreshPlans");
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
  });

  it("orders case remove and delete commands together in the manifest", async function () {
    this.timeout(20000);
    const extension = getKiwifsExtension();
    assert.ok(extension);
    const packageJsonPath = path.join(extension!.extensionPath, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      contributes?: { menus?: { ["view/item/context"]?: Array<{ command: string; when?: string; group?: string }> } };
    };

    const caseMenus = (packageJson.contributes?.menus?.["view/item/context"] ?? []).filter(
      (item) => item.when === "view == kiwiPlans && viewItem == caseDocument"
    );
    const removeIndex = caseMenus.findIndex((item) => item.command === "kiwi.removeCaseFromPlan");
    const deleteIndex = caseMenus.findIndex((item) => item.command === "kiwi.deleteCase");

    assert.notEqual(removeIndex, -1);
    assert.notEqual(deleteIndex, -1);
    assert.equal(deleteIndex, removeIndex + 1);
  });

  it("contributes plan context commands with this-plan wording", async function () {
    this.timeout(20000);
    const extension = getKiwifsExtension();
    assert.ok(extension);
    const packageJsonPath = path.join(extension!.extensionPath, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      contributes?: {
        commands?: Array<{ command: string; title?: string }>;
        menus?: { ["view/item/context"]?: Array<{ command: string; when?: string; group?: string }> };
      };
    };

    const commands = packageJson.contributes?.commands ?? [];
    const viewItemContext = packageJson.contributes?.menus?.["view/item/context"] ?? [];
    const planMenus = viewItemContext.filter(
      (item) => item.when === "view == kiwiPlans && viewItem == plan"
    );

    assert.equal(
      commands.find((item) => item.command === "kiwi.showPlanInfo")?.title,
      "テスト計画の情報を表示"
    );
    assert.equal(
      commands.find((item) => item.command === "kiwi.openPlanInBrowser")?.title,
      "テスト計画をブラウザで表示"
    );
    assert.equal(
      commands.find((item) => item.command === "kiwi.createCase")?.title,
      "テスト計画に新規テストケースを作成"
    );
    assert.equal(
      commands.find((item) => item.command === "kiwi.addExistingCaseToPlan")?.title,
      "テスト計画に既存テストケースを追加"
    );
    assert.equal(
      commands.find((item) => item.command === "kiwi.removeCaseFromPlanFromPlan")?.title,
      "テスト計画からテストケースを外す"
    );
    assert.notEqual(
      planMenus.findIndex((item) => item.command === "kiwi.removeCaseFromPlanFromPlan"),
      -1
    );
  });

  it("configures base url username and password through dedicated commands", async function () {
    this.timeout(20000);
    const originalBaseUrl = harness.baseUrl;
    const expectedBaseUrl = "https://kiwi.example.test";
    const baseUrl = `${expectedBaseUrl}/`;
    const username = "admin";
    const password = "admin";

    try {
      const savedBaseUrl = await vscode.commands.executeCommand<string>(
        "kiwi.configureBaseUrl",
        baseUrl
      );
      const savedUsername = await vscode.commands.executeCommand<string>(
        "kiwi.configureUsername",
        username
      );
      const savedPassword = await vscode.commands.executeCommand<string>(
        "kiwi.configurePassword",
        password
      );

      assert.equal(savedBaseUrl, expectedBaseUrl);
      assert.equal(savedUsername, username);
      assert.equal(savedPassword, password);
      assert.equal(
        vscode.workspace.getConfiguration("kiwi").get<string>("baseUrl"),
        expectedBaseUrl
      );

      const resolved = await vscode.commands.executeCommand<{
        baseUrl: string;
        username: string;
        password: string;
      }>("kiwi.__test.resolveConfig");
      assert.deepEqual(resolved, {
        baseUrl: expectedBaseUrl,
        username,
        password
      });
    } finally {
      await vscode.workspace.getConfiguration("kiwi").update(
        "baseUrl",
        originalBaseUrl,
        vscode.ConfigurationTarget.Global
      );
    }
  });

  it("contributes welcome content for setup and open-root states", async function () {
    this.timeout(20000);
    const extension = getKiwifsExtension();
    assert.ok(extension);
    const viewsWelcome = (extension.packageJSON.contributes?.viewsWelcome ?? []) as Array<{
      view: string;
      contents: string;
      when: string;
    }>;
    const kiwiWelcome = viewsWelcome.filter((item) => item.view === "kiwiPlans");
    assert.equal(kiwiWelcome.length, 2);
    assert.ok(kiwiWelcome.some((item) => item.when === "config.kiwi.baseUrl == ''"));
    assert.ok(kiwiWelcome.some((item) => item.when === "config.kiwi.baseUrl != ''"));
    assert.ok(
      kiwiWelcome.some(
        (item) =>
          item.contents.includes("ベース URL を設定") &&
          item.contents.includes("ユーザー名を設定") &&
          item.contents.includes("パスワードを設定")
      )
    );
    assert.ok(kiwiWelcome.some((item) => item.contents.includes("ルートを開く")));
  });

  it("gates runtime log commands behind debug-f5 context keys", async function () {
    this.timeout(20000);
    const extension = getKiwifsExtension();
    assert.ok(extension);

    const menus = extension.packageJSON.contributes?.menus ?? {};
    const viewTitle = (menus["view/title"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;
    const commandPalette = (menus.commandPalette ?? []) as Array<{
      command: string;
      when?: string;
    }>;

    const clearViewTitle = viewTitle.find((item) => item.command === "kiwi.clearRuntimeLogs");
    const revealViewTitle = viewTitle.find((item) => item.command === "kiwi.revealRuntimeLogs");
    const clearPalette = commandPalette.find((item) => item.command === "kiwi.clearRuntimeLogs");
    const revealPalette = commandPalette.find((item) => item.command === "kiwi.revealRuntimeLogs");

    assert.equal(clearViewTitle?.when, "view == kiwiPlans && kiwi.runtimeLogsEnabled");
    assert.equal(revealViewTitle?.when, "view == kiwiPlans && kiwi.runtimeLogsEnabled");
    assert.equal(clearPalette?.when, "kiwi.runtimeLogsEnabled");
    assert.equal(revealPalette?.when, "kiwi.runtimeLogsEnabled");
  });

  it("contributes filter-first case actions in the kiwi plans view title", async function () {
    this.timeout(20000);
    const extension = getKiwifsExtension();
    assert.ok(extension);

    const menus = extension.packageJSON.contributes?.menus ?? {};
    const viewTitle = (menus["view/title"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;

    const kiwiPlansItems = viewTitle
      .filter((item) => item.when === "view == kiwiPlans")
      .map((item) => item.command);

    assert.deepEqual(kiwiPlansItems.slice(0, 4), [
      "kiwi.filterCases",
      "kiwi.openTestRunDashboard",
      "kiwi.filterTestRuns",
      "kiwi.refreshPlans"
    ]);
    assert.ok(!kiwiPlansItems.includes("kiwi.searchCases"));

    const commands = (extension.packageJSON.contributes?.commands ?? []) as Array<{
      command: string;
      title: string;
      icon?: string;
    }>;
    assert.equal(commands.find((item) => item.command === "kiwi.filterCases")?.title, "Kiwi: テストケースを探す");
    assert.equal(commands.find((item) => item.command === "kiwi.filterTestRuns")?.title, "Kiwi: テスト実行を探す");
    assert.equal(commands.find((item) => item.command === "kiwi.filterCases")?.icon, "$(search)");
    assert.equal(commands.find((item) => item.command === "kiwi.filterTestRuns")?.icon, "$(search)");

    const commandPalette = (menus.commandPalette ?? []) as Array<{
      command: string;
      when?: string;
    }>;
    assert.equal(commandPalette.find((item) => item.command === "kiwi.searchCases")?.when, "false");
  });

  it("contributes manual case freshness check to case context and editor title", async function () {
    this.timeout(20000);
    const extension = getKiwifsExtension();
    assert.ok(extension);

    const commands = (extension.packageJSON.contributes?.commands ?? []) as Array<{
      command: string;
      title: string;
    }>;
    const menus = extension.packageJSON.contributes?.menus ?? {};
    const viewItemContext = (menus["view/item/context"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;
    const editorTitle = (menus["editor/title"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;

    assert.equal(
      commands.find((item) => item.command === "kiwi.checkCaseFreshness")?.title,
      "テストケースの最新状態を確認"
    );
    assert.equal(
      viewItemContext.find((item) => item.command === "kiwi.checkCaseFreshness")?.when,
      "view == kiwiPlans && viewItem == caseDocument"
    );
    assert.equal(
      editorTitle.find((item) => item.command === "kiwi.checkCaseFreshness")?.when,
      "resourceScheme == kiwi && resourcePath =~ /\\/cases\\/.+\\.md$/"
    );
  });

  it("uses .env fallback only in debug-f5 mode", async function () {
    this.timeout(20000);
    const originalRuntimeMode = process.env.KIWI_RUNTIME_MODE;
    const originalBaseUrl = vscode.workspace.getConfiguration("kiwi").get<string>("baseUrl") ?? "";
    const originalStored = await vscode.commands.executeCommand<{
      baseUrl: string;
      username?: string;
      password?: string;
    }>("kiwi.__test.readStoredConfiguration");

    await vscode.commands.executeCommand("kiwi.clearConfiguration", true);

    try {
      process.env.KIWI_RUNTIME_MODE = "production";
      await assert.rejects(
        async () => {
          await vscode.commands.executeCommand("kiwi.__test.resolveConfig");
        },
        /Kiwi configuration is incomplete/
      );

      process.env.KIWI_RUNTIME_MODE = "debug-f5";
      const resolved = await vscode.commands.executeCommand<{
        baseUrl: string;
        username: string;
        password: string;
      }>("kiwi.__test.resolveConfig");
      assert.equal(resolved?.baseUrl, "https://env.example");
      assert.equal(resolved?.username, "admin");
      assert.equal(resolved?.password, "admin");
    } finally {
      process.env.KIWI_RUNTIME_MODE = originalRuntimeMode;
      await vscode.workspace
        .getConfiguration("kiwi")
        .update("baseUrl", originalBaseUrl, vscode.ConfigurationTarget.Global);
      if (originalStored?.username) {
        await vscode.commands.executeCommand("kiwi.configureUsername", originalStored.username);
      } else {
        await vscode.commands.executeCommand("kiwi.clearUsername", true);
      }
      if (originalStored?.password) {
        await vscode.commands.executeCommand("kiwi.configurePassword", originalStored.password);
      } else {
        await vscode.commands.executeCommand("kiwi.clearPassword", true);
      }
    }
  });

  it("clears base url username password and all configuration through dedicated commands", async function () {
    this.timeout(20000);
    const originalBaseUrl = vscode.workspace.getConfiguration("kiwi").get<string>("baseUrl") ?? "";
    const originalStored = await vscode.commands.executeCommand<{
      baseUrl: string;
      username?: string;
      password?: string;
    }>("kiwi.__test.readStoredConfiguration");

    await vscode.commands.executeCommand("kiwi.configureBaseUrl", "https://kiwi.example.test/");
    await vscode.commands.executeCommand("kiwi.configureUsername", "admin");
    await vscode.commands.executeCommand("kiwi.configurePassword", "admin");

    try {
      const clearedBaseUrl = await vscode.commands.executeCommand<boolean>("kiwi.clearBaseUrl", true);
      assert.equal(clearedBaseUrl, true);
      assert.equal(vscode.workspace.getConfiguration("kiwi").get<string>("baseUrl"), "");

      await vscode.commands.executeCommand("kiwi.configureBaseUrl", "https://kiwi.example.test/");
      const clearedUsername = await vscode.commands.executeCommand<boolean>("kiwi.clearUsername", true);
      assert.equal(clearedUsername, true);

      let stored = await vscode.commands.executeCommand<{
        baseUrl: string;
        username?: string;
        password?: string;
      }>("kiwi.__test.readStoredConfiguration");
      assert.equal(stored.baseUrl, "https://kiwi.example.test");
      assert.equal(stored.username, undefined);
      assert.equal(stored.password, "admin");

      await vscode.commands.executeCommand("kiwi.configureUsername", "admin");
      const clearedPassword = await vscode.commands.executeCommand<boolean>("kiwi.clearPassword", true);
      assert.equal(clearedPassword, true);

      stored = await vscode.commands.executeCommand<{
        baseUrl: string;
        username?: string;
        password?: string;
      }>("kiwi.__test.readStoredConfiguration");
      assert.equal(stored.username, "admin");
      assert.equal(stored.password, undefined);

      await vscode.commands.executeCommand("kiwi.configurePassword", "admin");
      const clearedAll = await vscode.commands.executeCommand<boolean>(
        "kiwi.clearConfiguration",
        true
      );
      assert.equal(clearedAll, true);

      stored = await vscode.commands.executeCommand<{
        baseUrl: string;
        username?: string;
        password?: string;
      }>("kiwi.__test.readStoredConfiguration");
      assert.equal(stored.baseUrl, "");
      assert.equal(stored.username, undefined);
      assert.equal(stored.password, undefined);
    } finally {
      await vscode.workspace
        .getConfiguration("kiwi")
        .update("baseUrl", originalBaseUrl, vscode.ConfigurationTarget.Global);
      if (originalStored?.username) {
        await vscode.commands.executeCommand("kiwi.configureUsername", originalStored.username);
      } else {
        await vscode.commands.executeCommand("kiwi.clearUsername", true);
      }
      if (originalStored?.password) {
        await vscode.commands.executeCommand("kiwi.configurePassword", originalStored.password);
      } else {
        await vscode.commands.executeCommand("kiwi.clearPassword", true);
      }
    }
  });

  it("writes updates and emits runtime jsonl", async function () {
    this.timeout(20000);
    const removed = await vscode.commands.executeCommand<number>("kiwi.clearRuntimeLogs");
    assert.ok(typeof removed === "number");

    const uri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md");
    const currentText = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    const nextText = `${currentText}\n\nUpdated from extension host.`;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(nextText, "utf8"));

    const logPath = process.env.KIWI_JSONL_PATH;
    assert.ok(logPath);
    const content = await waitForFile(logPath);
    assert.match(content, /"event":"session.started"/);
    assert.match(content, /runtimeRootConfigured=true/);
    assert.match(content, /envPathResolved=true/);
    assert.match(content, /case.update.succeeded/);

    const savedText = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    assert.match(savedText, /Updated from extension host\./);
  });

  it("fails save when session cache is missing", async function () {
    this.timeout(20000);
    const uri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/502 - Password reset works.md");

    await assert.rejects(
      async () => {
        await vscode.workspace.fs.writeFile(uri, Buffer.from("Unsaved direct write", "utf8"));
      },
      /Case document session is missing/
    );
  });

  it("opens read-only case metadata via show info", async function () {
    this.timeout(20000);
    const infoUri = await vscode.commands.executeCommand<string>("kiwi.__test.showCaseInfo");
    assert.ok(infoUri);
    assert.match(infoUri ?? "", /^kiwi-info:/);

    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(infoUri!));
    assert.equal(document.isDirty, false);
    assert.match(document.getText(), /# Login works/);
    assert.match(document.getText(), /\| status \| CONFIRMED \|/);
    assert.match(document.getText(), /\| components \| Auth \|/);
    assert.match(document.getText(), /\| tags \| smoke \|/);
    assert.match(document.getText(), /\| versionToken \| history_id:\d+ \|/);
  });

  it("creates a new case from the plan metadata editor flow", async function () {
    this.timeout(20000);
    const title = await vscode.commands.executeCommand<string>("kiwi.__test.createCase");
    assert.equal(title, "テスト計画に新規テストケースを作成: Regression");

    const initialState = await vscode.commands.executeCommand<{
      formState: { summary: string; status: string; priority: string; tagsInput: string };
      options: { statuses: string[]; priorities: string[] };
      templateOptions: Array<{ id: string; name: string; text: string; isDefault: boolean }>;
      selectedTemplateId: string;
      actionLabel: string;
      mode: string;
    }>("kiwi.__test.getMetadataEditorState", 100, "create");
    assert.equal(initialState?.formState.summary, "");
    assert.equal(initialState?.mode, "create");
    assert.equal(initialState?.actionLabel, "作成");
    assert.ok(initialState?.options.statuses.includes("CONFIRMED"));
    assert.ok(initialState?.options.priorities.includes("P1"));
    assert.equal(initialState?.templateOptions[0]?.name, "既定テンプレート");
    assert.equal(initialState?.templateOptions[1]?.name, "Regression Template");
    assert.equal(initialState?.selectedTemplateId, "default");

    const saveResult = await vscode.commands.executeCommand<{
      kind: string;
      mode: string;
      createdCase: { id: number; summary: string; text: string; components: string[]; notes: string };
    }>("kiwi.__test.submitMetadataEditor", {
      summary: "Created from panel",
      status: "CONFIRMED",
      priority: "P1",
      tagsInput: "smoke"
    }, 100, "create", "10");
    assert.equal(saveResult?.kind, "created");
    assert.equal(saveResult?.mode, "create");
    assert.equal(saveResult?.createdCase.summary, "Created from panel");

    const createdCaseId = saveResult!.createdCase.id;
    const snapshot = await vscode.commands.executeCommand<KiwiPlansTreeSnapshotNode[]>(
      "kiwi.__test.getPlanTreeSnapshot"
    );
    assert.ok(
      snapshot?.[0]?.children?.some((node) => node.label === `${createdCaseId} - Created from panel.md`)
    );

    const createdUri = vscode.Uri.parse(
      `kiwi:/plans/100 - Regression/cases/${createdCaseId} - Created from panel.md`
    );
    const opened = await waitForDocumentContent(createdUri, /# Template Purpose/);
    assert.match(opened.getText(), /Use this body from Kiwi template/);
    const state = await harness.readState();
    assert.equal(state.cases[String(createdCaseId)]?.summary, "Created from panel");
    assert.deepEqual(state.cases[String(createdCaseId)]?.components, []);
    assert.equal(state.cases[String(createdCaseId)]?.notes, "");
    assert.equal(state.cases[String(createdCaseId)]?.text, "# Template Purpose\n\nUse this body from Kiwi template.");
  });

  it("duplicates a case and opens the created body document", async function () {
    this.timeout(20000);
    const sourceState = await harness.readState();
    const sourceText = sourceState.cases["501"]?.text;
    assert.ok(sourceText);

    const title = await vscode.commands.executeCommand<string>("kiwi.__test.duplicateCase");
    assert.equal(title, "テストケースを複製: Login works");

    const initialState = await vscode.commands.executeCommand<{
      formState: { summary: string; status: string; priority: string; tagsInput: string };
      templateOptions: Array<{ id: string }>;
      actionLabel: string;
      mode: string;
    }>("kiwi.__test.getMetadataEditorState", 501, "duplicate");
    assert.equal(initialState?.formState.summary, "Login works");
    assert.equal(initialState?.mode, "duplicate");
    assert.equal(initialState?.actionLabel, "複製して作成");
    assert.equal(initialState?.templateOptions.length, 0);

    const saveResult = await vscode.commands.executeCommand<{
      kind: string;
      mode: string;
      sourceCaseId?: number;
      createdCase: { id: number; summary: string; text: string; category: string; components: string[] };
    }>("kiwi.__test.submitMetadataEditor", {
      summary: "Login works copy",
      status: "IDLE",
      priority: "P2",
      tagsInput: "regression, smoke"
    }, 501, "duplicate");
    assert.equal(saveResult?.kind, "created");
    assert.equal(saveResult?.mode, "duplicate");
    assert.equal(saveResult?.sourceCaseId, 501);

    const duplicatedCaseId = saveResult!.createdCase.id;
    const duplicatedUri = vscode.Uri.parse(
      `kiwi:/plans/100 - Regression/cases/${duplicatedCaseId} - Login works copy.md`
    );
    await waitForDocumentContent(duplicatedUri, /# Purpose/);

    const duplicatedState = await vscode.commands.executeCommand<{
      summary: string;
      priority: string;
      status: string;
      tags: string[];
      components: string[];
      category: string;
      text: string;
    }>("kiwi.__test.readCaseState", duplicatedCaseId);
    assert.equal(duplicatedState?.summary, "Login works copy");
    assert.equal(duplicatedState?.priority, "P2");
    assert.equal(duplicatedState?.status, "IDLE");
    assert.deepEqual(duplicatedState?.tags, ["regression", "smoke"]);
    assert.deepEqual(duplicatedState?.components, []);
    assert.equal(duplicatedState?.text, sourceText);
  });

  it("updates one case execution result through the Webview form", async function () {
    this.timeout(20000);

    const title = await vscode.commands.executeCommand<string>(
      "kiwi.__test.recordCaseExecutionResult",
      9001
    );
    assert.equal(title, "テストケースの実行結果を更新: 501 - Login works");

    const initialState = await vscode.commands.executeCommand<{
      formState: { status: string; comment: string };
      statuses: Array<{ id: number; name: string }>;
      target: { execution: { id: number; runId: number } };
    }>("kiwi.__test.getExecutionResultState", 9001);
    assert.equal(initialState?.formState.status, "IDLE");
    assert.equal(initialState?.target.execution.runId, 300);
    assert.ok(initialState?.statuses.some((item) => item.name === "PASSED"));

    const saveResult = await vscode.commands.executeCommand<{
      executionId: number;
      updatedExecution: { status: string; comment?: string };
      changedFields: string[];
    }>("kiwi.__test.submitExecutionResult", 9001, {
      status: "PASSED",
      comment: "Verified from host test"
    });
    assert.equal(saveResult?.executionId, 9001);
    assert.deepEqual(saveResult?.changedFields.sort(), ["comment", "status"]);
    assert.equal(saveResult?.updatedExecution.status, "PASSED");

    const state = await harness.readState();
    assert.equal(state.executions?.["9001"]?.status, "PASSED");
    assert.equal(state.executions?.["9001"]?.comment, "Verified from host test");
  });

  it("opens the test run dashboard, opens an existing run, saves a row, and opens a case", async function () {
    this.timeout(20000);

    const title = await vscode.commands.executeCommand<string>("kiwi.__test.openTestRunDashboard");
    assert.equal(title, "テスト実行ダッシュボード");

    const initialState = await vscode.commands.executeCommand<{
      testRuns: Array<{ id: number; summary: string }>;
      selectedRunId: string;
      message: string;
      rows: Array<{ executionId: number; caseId: number; status: string }>;
    }>("kiwi.__test.getTestRunDashboardState");
    assert.equal(initialState?.selectedRunId, "");
    assert.ok((initialState?.testRuns.length ?? 0) >= 2);
    assert.equal(initialState?.rows.length, 0);
    assert.match(initialState?.message ?? "", /既存の Test Run を開いてください|Test Run を作成してください/);

    const switched = await vscode.commands.executeCommand<{
      selectedRunId: string;
      rows: Array<{ executionId: number; caseId: number; status: string }>;
    }>("kiwi.__test.selectDashboardRun", 301);
    assert.equal(switched?.selectedRunId, "301");
    assert.equal(switched?.rows[0]?.executionId, 9002);

    const updated = await vscode.commands.executeCommand<{
      id: number;
      status: string;
      comment?: string;
    }>("kiwi.__test.saveDashboardRow", 9002, "BLOCKED", "Blocked in dashboard");
    assert.equal(updated?.id, 9002);
    assert.equal(updated?.status, "BLOCKED");

    const state = await harness.readState();
    assert.equal(state.executions?.["9002"]?.status, "BLOCKED");

    const opened = await vscode.commands.executeCommand<string>("kiwi.__test.openDashboardRow", 9002);
    assert.ok(opened?.includes("501"));

    const logDirectory = await vscode.commands.executeCommand<string>(
      "kiwi.__test.getResolvedRuntimeLogDirectory"
    );
    assert.ok(logDirectory);
    const latestLog = (
      await Promise.all(
        (await vscode.workspace.fs.readDirectory(vscode.Uri.file(logDirectory!)))
          .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".jsonl"))
          .map(async ([name]) => ({
            name,
            stat: await vscode.workspace.fs.stat(vscode.Uri.file(path.join(logDirectory!, name)))
          }))
      )
    ).sort((left, right) => right.stat.mtime - left.stat.mtime)[0];
    assert.ok(latestLog);
    const logContent = await readFile(path.join(logDirectory!, latestLog!.name), "utf8");
    assert.match(logContent, /testrun\.open\.succeeded/);
  });

  it("ignores tree target objects when opening the test run dashboard", async function () {
    this.timeout(20000);

    const caseTarget = {
      kind: "case",
      plan: { id: 100, name: "Regression" },
      caseRef: { id: 501, summary: "Login works" }
    };
    const planTarget = {
      kind: "plan",
      plan: { id: 100, name: "Regression" }
    };

    const caseTitle = await vscode.commands.executeCommand<string>("kiwi.openTestRunDashboard", caseTarget);
    assert.equal(caseTitle, "テスト実行ダッシュボード");
    const caseState = await vscode.commands.executeCommand<{
      selectedRunId: string;
      rows: Array<{ executionId: number }>;
    }>("kiwi.__test.getTestRunDashboardState");
    assert.notEqual(caseState, undefined);
    assert.doesNotMatch(caseState?.selectedRunId ?? "", /^\[object Object\]$/);

    const planTitle = await vscode.commands.executeCommand<string>("kiwi.openTestRunDashboard", planTarget);
    assert.equal(planTitle, "テスト実行ダッシュボード");
    const planState = await vscode.commands.executeCommand<{
      selectedRunId: string;
      rows: Array<{ executionId: number }>;
    }>("kiwi.__test.getTestRunDashboardState");
    assert.notEqual(planState, undefined);
    assert.doesNotMatch(planState?.selectedRunId ?? "", /^\[object Object\]$/);

    const logDirectory = await vscode.commands.executeCommand<string>(
      "kiwi.__test.getResolvedRuntimeLogDirectory"
    );
    assert.ok(logDirectory);
    const latestLog = (
      await Promise.all(
        (await vscode.workspace.fs.readDirectory(vscode.Uri.file(logDirectory!)))
          .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".jsonl"))
          .map(async ([name]) => ({
            name,
            stat: await vscode.workspace.fs.stat(vscode.Uri.file(path.join(logDirectory!, name)))
          }))
      )
    ).sort((left, right) => right.stat.mtime - left.stat.mtime)[0];
    assert.ok(latestLog);
    const logContent = await readFile(path.join(logDirectory!, latestLog!.name), "utf8");
    assert.doesNotMatch(logContent, /kiwi:\/testruns\/\[object Object\]/);
  });

  it("filters test runs in a Webview and opens a selected run in the dashboard", async function () {
    this.timeout(20000);

    const title = await vscode.commands.executeCommand<string>("kiwi.__test.filterTestRuns");
    assert.equal(title, "テスト実行を探す");

    const html = await vscode.commands.executeCommand<string>("kiwi.__test.getTestRunFilterHtml");
    assert.match(html ?? "", /<h1>テスト実行を探す<\/h1>/);
    assert.match(html ?? "", /<form id="form">/);
    assert.match(html ?? "", /type="submit">検索<\/button>/);

    const initialState = await vscode.commands.executeCommand<{
      formState: { query: string; planId: string; build: string };
      options: {
        plans: Array<{ value: string; label: string }>;
        buildOptionsByPlan: Record<string, string[]>;
      };
      results: Array<{ id: number }>;
    }>("kiwi.__test.getTestRunFilterState");
    assert.equal(initialState?.formState.query, "");
    assert.ok(initialState?.options.plans.some((plan) => plan.value === "100"));
    assert.deepEqual(initialState?.options.buildOptionsByPlan["100"], ["2026.04"]);
    assert.deepEqual(initialState?.options.buildOptionsByPlan["200"], ["2026.04-nightly"]);
    assert.deepEqual(initialState?.results, []);

    const results = await vscode.commands.executeCommand<
      Array<{ id: number; summary: string; build: string; planId?: number; planName: string }>
    >("kiwi.__test.submitTestRunFilter", {
      query: "Regression",
      planId: "100",
      build: "2026.04"
    });
    assert.deepEqual(results?.map((item) => item.id), [300]);
    assert.equal(results?.[0]?.summary, "Regression run");
    assert.equal(results?.[0]?.planId, 100);
    assert.equal(results?.[0]?.planName, "Regression");

    const opened = await vscode.commands.executeCommand<number | undefined>(
      "kiwi.__test.openTestRunFilterResult",
      300
    );
    assert.equal(opened, 300);

    const dashboardState = await vscode.commands.executeCommand<{
      selectedRunId: string;
      rows: Array<{ executionId: number; caseId: number }>;
    }>("kiwi.__test.getTestRunDashboardState");
    assert.equal(dashboardState?.selectedRunId, "300");
    assert.deepEqual(dashboardState?.rows.map((row) => row.executionId), [9001]);
  });

  it("creates runs, adds cases, and bulk updates selected dashboard rows", async function () {
    this.timeout(20000);

    await vscode.commands.executeCommand("kiwi.__test.openTestRunDashboard");
    const initial = await vscode.commands.executeCommand<{
      plans: Array<{ id: number; name: string }>;
      buildOptionsByPlan: Record<string, Array<{ id: number; name: string }>>;
      createForm: { planId: string; buildId: string; manager: string };
    }>("kiwi.__test.getTestRunDashboardState");
    assert.ok(initial?.plans.some((plan) => plan.id === 100));
    assert.equal(initial?.createForm.planId, "100");
    assert.equal(initial?.createForm.buildId, "1");
    assert.equal(initial?.createForm.manager, "admin");
    assert.deepEqual(initial?.buildOptionsByPlan["100"], [
      { id: 1, name: "2026.04" },
      { id: 2, name: "2026.04-phase3" }
    ]);

    const created = await vscode.commands.executeCommand<{
      id: number;
      summary: string;
      build: string;
      planId?: number;
      manager?: string;
    }>("kiwi.__test.createDashboardRun", {
      summary: "Phase 3 run",
      planId: 100,
      buildId: 2,
      manager: "admin"
    });
    assert.equal(created?.summary, "Phase 3 run");
    assert.equal(created?.planId, 100);
    assert.equal(created?.manager, "admin");

    const afterCreate = await vscode.commands.executeCommand<{
      selectedRunId: string;
      rows: Array<{ executionId: number }>;
    }>("kiwi.__test.getTestRunDashboardState");
    assert.equal(afterCreate?.selectedRunId, String(created?.id));
    assert.deepEqual(afterCreate?.rows, []);

    const afterAdd = await vscode.commands.executeCommand<{
      selectedRunId: string;
      rows: Array<{ executionId: number; caseId: number; status: string }>;
    }>("kiwi.__test.addCaseToDashboardRun", 502);
    assert.equal(afterAdd?.selectedRunId, String(created?.id));
    assert.equal(afterAdd?.rows.length, 1);
    assert.equal(afterAdd?.rows[0]?.caseId, 502);
    assert.equal(afterAdd?.rows[0]?.status, "IDLE");

    await vscode.commands.executeCommand("kiwi.__test.addCaseToDashboardRun", 501);
    const beforeBulk = await vscode.commands.executeCommand<{
      rows: Array<{ executionId: number; caseId: number; status: string }>;
    }>("kiwi.__test.getTestRunDashboardState");
    const selectedExecutionIds = beforeBulk?.rows.map((row) => row.executionId) ?? [];
    assert.equal(selectedExecutionIds.length, 2);

    const bulk = await vscode.commands.executeCommand<{ updated: number; failed: number }>(
      "kiwi.__test.bulkUpdateDashboardRows",
      selectedExecutionIds,
      "PASSED"
    );
    assert.deepEqual(bulk, { updated: 2, failed: 0 });

    const state = await harness.readState();
    for (const executionId of selectedExecutionIds) {
      assert.equal(state.executions?.[String(executionId)]?.status, "PASSED");
    }

    const logDirectory = await vscode.commands.executeCommand<string>(
      "kiwi.__test.getResolvedRuntimeLogDirectory"
    );
    assert.ok(logDirectory);
    const latestLog = (
      await Promise.all(
        (await vscode.workspace.fs.readDirectory(vscode.Uri.file(logDirectory!)))
          .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".jsonl"))
          .map(async ([name]) => ({
            name,
            stat: await vscode.workspace.fs.stat(vscode.Uri.file(path.join(logDirectory!, name)))
          }))
      )
    ).sort((left, right) => right.stat.mtime - left.stat.mtime)[0];
    assert.ok(latestLog);
    const logContent = await readFile(path.join(logDirectory!, latestLog!.name), "utf8");
    assert.match(logContent, /testrun\.create\.succeeded/);
    assert.match(logContent, /testrun\.add_case\.succeeded/);
    assert.match(logContent, /testrun\.bulk_status\.succeeded/);
  });

  it("returns an empty candidate list when the case has no executions", async function () {
    this.timeout(20000);

    await harness.seedCaseDocument({
      id: 777,
      planId: 100,
      summary: "No run case",
      priority: "P3",
      category: "Functional",
      status: "IDLE",
      components: [],
      tags: [],
      notes: "",
      text: "No run"
    });
    await harness.seedPlanCases(100, [501, 502, 777]);

    const result = await vscode.commands.executeCommand<unknown[]>(
      "kiwi.__test.recordCaseExecutionResult",
      undefined,
      777,
      "No run case"
    );
    assert.deepEqual(result, []);

    await harness.seedPlanCases(100, [501, 502]);
  });

  it("manages one case across multiple test runs through the case execution board", async function () {
    this.timeout(20000);

    const title = await vscode.commands.executeCommand<string>(
      "kiwi.__test.manageCaseExecutionsAcrossRuns",
      501,
      "Login works",
      100,
      "Regression"
    );
    assert.equal(title, "テストケースの実行を管理: 501 - Login works");

    const initialState = await vscode.commands.executeCommand<{
      plans: Array<{ id: number; name: string }>;
      buildOptionsByPlan: Record<string, Array<{ id: number; name: string }>>;
      addSection: { createForm: { planId: string; buildId: string; manager: string } };
      groups: Array<{
        planId: number;
        planName: string;
        rows: Array<{ runId: number; executionId: number; status: string }>;
      }>;
    }>("kiwi.__test.getCaseExecutionBoardState", 501);
    assert.equal(initialState?.groups.length, 2);
    assert.equal(initialState?.plans.length ?? 0, 0);
    assert.equal(initialState?.addSection.createForm.planId, "100");
    assert.equal(initialState?.addSection.createForm.buildId, "1");
    assert.equal(initialState?.addSection.createForm.manager, "admin");
    assert.deepEqual(initialState?.buildOptionsByPlan["100"], [
      { id: 1, name: "2026.04" },
      { id: 2, name: "2026.04-phase3" }
    ]);
    assert.ok(initialState?.groups.find((group) => group.planId === 100)?.rows.some((row) => row.runId === 300));
    assert.ok(initialState?.groups.find((group) => group.planId === 200)?.rows.some((row) => row.runId === 301));
    assert.ok(!(initialState?.groups.find((group) => group.planId === 200)?.rows.some((row) => row.runId === 302)));

    const created = await vscode.commands.executeCommand<{
      id: number;
      planId?: number;
      build: string;
    }>("kiwi.__test.createCaseExecutionBoardRun", 501, {
      planId: 100,
      summary: "Regression extra run",
      buildId: 2,
      manager: "admin"
    });
    assert.equal(created?.planId, 100);
    assert.equal(created?.build, "2026.04-phase3");

    const afterCreate = await vscode.commands.executeCommand<{
      groups: Array<{
        planId: number;
        rows: Array<{ runId: number; executionId: number; status: string }>;
      }>;
    }>("kiwi.__test.getCaseExecutionBoardState", 501);
    const createdRow = afterCreate?.groups
      .flatMap((group) => group.rows)
      .find((row) => row.runId === created?.id);
    assert.equal(createdRow?.status, "IDLE");

    const afterAdd = await vscode.commands.executeCommand<{
      groups: Array<{
        planId: number;
        rows: Array<{ runId: number; executionId: number; status: string }>;
      }>;
    }>("kiwi.__test.addCaseExecutionBoardRun", 501, 302);
    const addedRow = afterAdd?.groups
      .flatMap((group) => group.rows)
      .find((row) => row.runId === 302);
    assert.equal(addedRow?.status, "IDLE");

    const saved = await vscode.commands.executeCommand<{
      id: number;
      runId: number;
      status: string;
      comment?: string;
    }>("kiwi.__test.saveCaseExecutionBoardRow", 501, 301, "PASSED", "Updated from board");
    assert.equal(saved?.runId, 301);
    assert.equal(saved?.status, "PASSED");

    const state = await harness.readState();
    assert.equal(state.executions?.["9002"]?.status, "PASSED");
    assert.match(state.executions?.["9002"]?.comment ?? "", /Updated from board/);
    const createdExecution = Object.values(state.executions ?? {}).find(
      (execution) => execution.runId === created?.id && execution.caseId === 501
    );
    assert.ok(createdExecution);
    const addedExecution = Object.values(state.executions ?? {}).find(
      (execution) => execution.runId === 302 && execution.caseId === 501
    );
    assert.ok(addedExecution);

    const opened = await vscode.commands.executeCommand<string>(
      "kiwi.__test.openCaseExecutionBoardRow",
      501,
      301
    );
    assert.ok(opened?.includes("501"));

    const logDirectory = await vscode.commands.executeCommand<string>(
      "kiwi.__test.getResolvedRuntimeLogDirectory"
    );
    assert.ok(logDirectory);
    const latestLog = (
      await Promise.all(
        (await vscode.workspace.fs.readDirectory(vscode.Uri.file(logDirectory!)))
          .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".jsonl"))
          .map(async ([name]) => ({
            name,
            stat: await vscode.workspace.fs.stat(vscode.Uri.file(path.join(logDirectory!, name)))
          }))
      )
    ).sort((left, right) => right.stat.mtime - left.stat.mtime)[0];
    assert.ok(latestLog);
    const logContent = await readFile(path.join(logDirectory!, latestLog!.name), "utf8");
    assert.match(logContent, /case-execution-board\.opened/);
    assert.match(logContent, /case-execution-board\.create_run\.succeeded/);
    assert.match(logContent, /case-execution-board\.add_case\.succeeded/);
    assert.match(logContent, /case-execution-board\.save_execution\.succeeded/);
  });

  it("opens metadata editor panel and saves summary status priority and tags", async function () {
    this.timeout(20000);
    const oldBodyUri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md");
    const oldBodyDocument = await vscode.workspace.openTextDocument(oldBodyUri);
    await vscode.window.showTextDocument(oldBodyDocument);

    const title = await vscode.commands.executeCommand<string>("kiwi.__test.editCaseMetadata");
    assert.equal(title, "テストケースのメタデータを編集: Login works");
    const initialState = await vscode.commands.executeCommand<{
      formState: { summary: string; status: string; priority: string; tagsInput: string };
      options: { statuses: string[]; priorities: string[] };
      title: string;
    }>("kiwi.__test.getMetadataEditorState");
    assert.equal(initialState?.formState.summary, "Login works");
    assert.equal(initialState?.formState.status, "CONFIRMED");
    assert.equal(initialState?.formState.priority, "P1");
    assert.equal(initialState?.formState.tagsInput, "smoke");
    assert.ok(initialState?.options.statuses.includes("IDLE"));
    assert.ok(initialState?.options.priorities.includes("P2"));

    const saveResult = await vscode.commands.executeCommand<{
      updatedCase: { summary: string; status: string; priority: string; tags: string[] };
      changedFields: string[];
    }>("kiwi.__test.submitMetadataEditor", {
      summary: "Login updated",
      status: "IDLE",
      priority: "P2",
      tagsInput: "regression, smoke"
    });
    assert.deepEqual(saveResult?.changedFields.sort(), ["priority", "status", "summary", "tags"]);

    const state = await harness.readState();
    assert.equal(state.cases["501"]?.summary, "Login updated");
    assert.equal(state.cases["501"]?.status, "IDLE");
    assert.equal(state.cases["501"]?.priority, "P2");
    assert.deepEqual(state.cases["501"]?.tags, ["regression", "smoke"]);
    const updatedState = await vscode.commands.executeCommand<{
      formState: { summary: string; status: string; priority: string; tagsInput: string };
      title: string;
    }>("kiwi.__test.getMetadataEditorState");
    assert.equal(updatedState?.formState.summary, "Login updated");
    assert.equal(updatedState?.title, "テストケースのメタデータを編集: Login updated");

    const newBodyUri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login updated.md");
    await waitForTabState(newBodyUri.toString(), true);
    await waitForTabState(oldBodyUri.toString(), false);

    const snapshot = await vscode.commands.executeCommand<KiwiPlansTreeSnapshotNode[]>(
      "kiwi.__test.getPlanTreeSnapshot"
    );
    assert.match(snapshot?.[0]?.children?.[0]?.label ?? "", /^501 - Login updated\.md$/);
  });

  it("does not reopen dirty opened case document when summary changes through metadata save", async function () {
    this.timeout(20000);
    try {
      await harness.simulateRemoteChange(501, (current) => ({
        ...current,
        summary: "Login updated",
        priority: "P2",
        status: "IDLE",
        tags: ["regression", "smoke"]
      }));
      await vscode.commands.executeCommand("kiwi.refreshPlans");

      const oldBodyUri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login updated.md");
      const bodyDocument = await vscode.workspace.openTextDocument(oldBodyUri);
      const bodyEditor = await vscode.window.showTextDocument(bodyDocument);
      await bodyEditor.edit((editBuilder) => {
        editBuilder.insert(new vscode.Position(bodyDocument.lineCount, 0), "\nDirty body draft.");
      });
      assert.equal(bodyDocument.isDirty, true);

      await vscode.commands.executeCommand("kiwi.__test.editCaseMetadata");
      const saveResult = await vscode.commands.executeCommand<{
        updatedCase: { summary: string };
      }>("kiwi.__test.submitMetadataEditor", {
        summary: "Login final",
        status: "CONFIRMED",
        priority: "P3",
        tagsInput: "smoke"
      });
      assert.equal(saveResult?.updatedCase.summary, "Login final");

      const state = await harness.readState();
      assert.equal(state.cases["501"]?.summary, "Login final");
      assert.match(bodyDocument.getText(), /Dirty body draft\./);
      assert.equal(await waitForTabState(oldBodyUri.toString(), true), true);
      assert.equal(
        hasTabForUri("kiwi:/plans/100 - Regression/cases/501 - Login final.md"),
        false
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.files.revert");
      await harness.simulateRemoteChange(501, (current) => ({
        ...current,
        summary: "Login works",
        priority: "P1",
        status: "CONFIRMED",
        tags: ["smoke"]
      }));
      await vscode.commands.executeCommand("kiwi.refreshPlans");
    }
  });

  it("opens read-only case attachments via show attachments", async function () {
    this.timeout(20000);
    const attachmentsUri = await vscode.commands.executeCommand<string>("kiwi.__test.showCaseAttachments");
    assert.ok(attachmentsUri);
    assert.match(attachmentsUri ?? "", /^kiwi-attachments:/);

    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(attachmentsUri!));
    assert.equal(document.isDirty, false);
    assert.match(document.getText(), /# Attachments: Login works/);
    assert.match(document.getText(), /\| existing\.txt \| 5 \|/);
  });

  it("resolves browser-openable attachment urls from a case target", async function () {
    this.timeout(20000);
    const resolved = await vscode.commands.executeCommand<string>(
      "kiwi.__test.openCaseAttachmentInBrowser"
    );
    assert.equal(
      resolved,
      `${harness.baseUrl.replace(/\/$/, "")}/attachments/501/existing.txt`
    );
  });

  it("opens text attachments in a read-only editor document", async function () {
    this.timeout(20000);
    const attachmentUri = await vscode.commands.executeCommand<string>(
      "kiwi.__test.openCaseAttachmentInEditor"
    );
    assert.ok(attachmentUri);
    assert.match(attachmentUri ?? "", /^kiwi-attachment:/);

    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(attachmentUri!));
    assert.equal(document.isDirty, false);
    assert.equal(document.getText(), "hello");
  });

  it("opens previewable binary attachments from a temp file", async function () {
    this.timeout(20000);
    const removed = await vscode.commands.executeCommand<number>("kiwi.clearRuntimeLogs");
    assert.ok(typeof removed === "number");
    const result = await vscode.commands.executeCommand<string>(
      "kiwi.__test.openCaseAttachmentInEditor",
      "attachment"
    );
    assert.ok(result);
    assert.match(result ?? "", /^file:/);
    const logPath = process.env.KIWI_JSONL_PATH;
    assert.ok(logPath);
    const content = await waitForFileMatching(logPath, /openMethod=openWith:imagePreview\.previewEditor/);
    assert.match(content, /"event":"attachment.editor.classified"/);
    assert.match(content, /attachmentFilename=attachment/);
    assert.match(content, /contentFilename=diagram\.svg/);
    assert.match(content, /viewKind=preview-image/);
    assert.match(content, /"event":"attachment.editor.opened"/);
    assert.match(content, /openMethod=openWith:imagePreview\.previewEditor/);
  });

  it("adds attachments through command and internal upload helper", async function () {
    this.timeout(20000);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot);
    const addPath = path.join(workspaceRoot!, "attachment-add.txt");
    const dropAPath = path.join(workspaceRoot!, "attachment-drop-a.txt");
    const dropBPath = path.join(workspaceRoot!, "attachment-drop-b.txt");
    await writeFile(addPath, "added by command", "utf8");
    await writeFile(dropAPath, "added by drop a", "utf8");
    await writeFile(dropBPath, "added by drop b", "utf8");

    await vscode.commands.executeCommand("kiwi.__test.addCaseAttachment", addPath);
    await vscode.commands.executeCommand("kiwi.__test.dropAttachments", [dropAPath, dropBPath], {
      kind: "case",
      plan: { id: 100, name: "Regression" },
      caseRef: { id: 501, summary: "Login works" }
    });

    const attachmentsUri = await vscode.commands.executeCommand<string>("kiwi.__test.showCaseAttachments");
    const document = await waitForDocumentContent(
      vscode.Uri.parse(attachmentsUri!),
      /\| attachment-drop-b\.txt \| 15 \|/
    );
    assert.match(document.getText(), /\| attachment-add\.txt \| 16 \|/);
    assert.match(document.getText(), /\| attachment-drop-a\.txt \| 15 \|/);
    assert.match(document.getText(), /\| attachment-drop-b\.txt \| 15 \|/);

    await rm(addPath, { force: true });
    await rm(dropAPath, { force: true });
    await rm(dropBPath, { force: true });
  });

  it("opens case diff from a tree target", async function () {
    this.timeout(20000);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    const baselineUri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md");
    const baselineDocument = await vscode.workspace.openTextDocument(baselineUri);
    assert.doesNotMatch(baselineDocument.getText(), /Changed on remote side\./);

    await harness.simulateRemoteChange(501, (current) => ({
      ...current,
      text: `${current.text}\n\nChanged on remote side.`
    }));

    const diffResult = await vscode.commands.executeCommand<{
      localUri: string;
      remoteUri: string;
      title: string;
    }>("kiwi.__test.showCaseDiff");

    assert.ok(diffResult);
    assert.equal(diffResult?.title, "Login works (Local ↔ Remote)");

    const localDocument = await vscode.workspace.openTextDocument(vscode.Uri.parse(diffResult!.localUri));
    const remoteDocument = await vscode.workspace.openTextDocument(vscode.Uri.parse(diffResult!.remoteUri));
    assert.doesNotMatch(localDocument.getText(), /Changed on remote side\./);
    assert.match(remoteDocument.getText(), /Changed on remote side\./);
  });

  it("opens case history diff from a tree target", async function () {
    this.timeout(20000);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    const diffResult = await vscode.commands.executeCommand<{
      historyUri: string;
      latestUri: string;
      title: string;
    }>("kiwi.__test.showCaseHistoryDiff", 10);

    assert.ok(diffResult);
    assert.equal(diffResult?.title, "Login works (History 10 ↔ History 11)");

    const historyDocument = await vscode.workspace.openTextDocument(vscode.Uri.parse(diffResult!.historyUri));
    const latestDocument = await vscode.workspace.openTextDocument(vscode.Uri.parse(diffResult!.latestUri));
    assert.match(historyDocument.getText(), /Historical body\./);
    assert.doesNotMatch(latestDocument.getText(), /Historical body\./);
    assert.match(latestDocument.getText(), /One-step newer body\./);
  });

  it("opens a read-only case history list from a tree target", async function () {
    this.timeout(20000);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    const uriString = await vscode.commands.executeCommand<string>("kiwi.__test.showCaseHistory");

    assert.ok(uriString);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriString!));
    assert.equal(document.uri.scheme, "kiwi-history");
    assert.match(document.getText(), /# History: Login works/);
    assert.doesNotMatch(document.getText(), /\| history_id \| history_date \| history_type \| history_change_reason \|/);
    assert.match(document.getText(), /## History 11/);
    assert.match(document.getText(), /- date: 2026-04-06T00:00:00.000Z/);
    assert.match(document.getText(), /- reason: latest body/);
    assert.match(document.getText(), /---/);
    assert.match(document.getText(), /## History 10/);
    assert.doesNotMatch(document.getText(), /\| history_id \|/);
  });

  it("resolves case browser urls from tree targets and active editors", async function () {
    this.timeout(20000);
    const fromTree = await vscode.commands.executeCommand<string>("kiwi.__test.openInBrowser");
    assert.equal(fromTree, `${harness.baseUrl.replace(/\/$/, "")}/case/501/`);

    const uri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md");
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    const fromEditor = await vscode.commands.executeCommand<string>("kiwi.__test.openInBrowser", undefined);
    assert.equal(fromEditor, `${harness.baseUrl.replace(/\/$/, "")}/case/501/`);
  });

  it("resolves plan browser urls from tree targets", async function () {
    this.timeout(20000);
    const resolved = await vscode.commands.executeCommand<string>("kiwi.__test.openPlanInBrowser");
    assert.equal(resolved, `${harness.baseUrl.replace(/\/$/, "")}/plan/100/`);
  });

  it("opens read-only plan detail via show plan info", async function () {
    this.timeout(20000);
    const infoUri = await vscode.commands.executeCommand<string>("kiwi.__test.showPlanInfo");
    assert.ok(infoUri);
    assert.match(infoUri ?? "", /^kiwi-plan-info:/);

    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(infoUri!));
    assert.equal(document.isDirty, false);
    assert.match(document.getText(), /# Regression/);
    assert.match(document.getText(), /- id: 100/);
    assert.match(document.getText(), /## Text/);
  });

  it("downloads plan-local mirrors in bulk and shows plan status report", async function () {
    this.timeout(20000);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot);
    const snapshot = await vscode.commands.executeCommand<KiwiPlansTreeSnapshotNode[]>(
      "kiwi.__test.getPlanTreeSnapshot"
    );
    const caseCount = snapshot?.[0]?.children?.length ?? 0;

    const bulk = await vscode.commands.executeCommand<{
      downloaded: number;
      overwritten: number;
      skipped: number;
      failed: number;
    }>("kiwi.__test.downloadPlanToLocalMirror", false, true);
    assert.deepEqual(bulk, { downloaded: caseCount, overwritten: 0, skipped: 0, failed: 0 });

    const loginMirror = path.join(
      workspaceRoot!,
      ".kiwi-mirror",
      "plans",
      "100 - Regression",
      "cases",
      "501 - Login works.md"
    );
    const resetMirror = path.join(
      workspaceRoot!,
      ".kiwi-mirror",
      "plans",
      "100 - Regression",
      "cases",
      "502 - Password reset works.md"
    );
    assert.match(await readFile(loginMirror, "utf8"), /Login succeeds\./);
    assert.match(await readFile(resetMirror, "utf8"), /Password reset text/);

    await writeFile(loginMirror, "Modified in bulk mirror", "utf8");

    const secondBulk = await vscode.commands.executeCommand<{
      downloaded: number;
      overwritten: number;
      skipped: number;
      failed: number;
    }>("kiwi.__test.downloadPlanToLocalMirror", false, true);
    assert.deepEqual(secondBulk, {
      downloaded: caseCount - 1,
      overwritten: 0,
      skipped: 1,
      failed: 0
    });
    assert.equal(await readFile(loginMirror, "utf8"), "Modified in bulk mirror");

    const forcedBulk = await vscode.commands.executeCommand<{
      downloaded: number;
      overwritten: number;
      skipped: number;
      failed: number;
    }>("kiwi.__test.downloadPlanToLocalMirror", true);
    assert.deepEqual(forcedBulk, {
      downloaded: caseCount - 1,
      overwritten: 1,
      skipped: 0,
      failed: 0
    });
    assert.match(await readFile(loginMirror, "utf8"), /Login succeeds\./);

    const reportUri = await vscode.commands.executeCommand<string>(
      "kiwi.__test.showPlanLocalMirrorStatus"
    );
    assert.ok(reportUri);
    assert.match(reportUri ?? "", /^kiwi-plan-local-mirror:/);
    const reportDocument = await vscode.workspace.openTextDocument(vscode.Uri.parse(reportUri!));
    assert.equal(reportDocument.isDirty, false);
    assert.match(reportDocument.getText(), /# Local Mirror Status: Regression/);
    assert.match(reportDocument.getText(), /\| 501 \| Login works \| unchanged \|/);
    assert.match(reportDocument.getText(), /\| 502 \| Password reset works \| unchanged \|/);

    await rm(path.join(workspaceRoot!, ".kiwi-mirror"), { recursive: true, force: true });
  });

  it("downloads compares uploads and reveals local mirrors", async function () {
    this.timeout(20000);
    const downloaded = await vscode.commands.executeCommand<{ localPath: string }>(
      "kiwi.__test.downloadLocalMirror"
    );
    assert.ok(downloaded?.localPath);
    assert.match(await readFile(downloaded!.localPath, "utf8"), /Login succeeds\./);

    await writeFile(downloaded!.localPath, "# Purpose\n\nLogin succeeds.\n\nChanged locally.\n", "utf8");
    await harness.simulateRemoteChange(501, (current) => ({
      ...current,
      text: `${current.text}\n\nChanged remotely.`
    }));

    const conflictCompare = await vscode.commands.executeCommand<{
      localUri: string;
      remoteUri: string;
      status: string;
    }>("kiwi.__test.compareLocalMirror");
    assert.equal(conflictCompare?.status, "conflict");
    const conflictLocal = await vscode.workspace.openTextDocument(vscode.Uri.parse(conflictCompare!.localUri));
    const conflictRemote = await vscode.workspace.openTextDocument(vscode.Uri.parse(conflictCompare!.remoteUri));
    assert.match(conflictLocal.getText(), /Changed locally\./);
    assert.match(conflictRemote.getText(), /Changed remotely\./);

    const forced = await vscode.commands.executeCommand<{ localPath: string }>(
      "kiwi.__test.downloadLocalMirror",
      true
    );
    assert.ok(forced?.localPath);
    assert.equal(await readFile(forced!.localPath, "utf8"), `${(await harness.readState()).cases["501"]?.text ?? ""}`);

    await rm(downloaded!.localPath, { force: true });
    const redownloaded = await vscode.commands.executeCommand<{ localPath: string }>(
      "kiwi.__test.downloadLocalMirror"
    );
    assert.ok(redownloaded?.localPath);
    await writeFile(redownloaded!.localPath, `${await readFile(redownloaded!.localPath, "utf8")}\n\nUploaded from mirror.\n`, "utf8");

    const kiwiUri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md");
    const kiwiDocument = await vscode.workspace.openTextDocument(kiwiUri);
    await vscode.window.showTextDocument(kiwiDocument);

    const uploaded = await vscode.commands.executeCommand<{
      localPath: string;
      uploadedVersionToken: string;
    }>("kiwi.__test.uploadLocalMirror");
    assert.ok(uploaded?.uploadedVersionToken);
    assert.match((await harness.readState()).cases["501"]?.text ?? "", /Uploaded from mirror\./);
    assert.match(kiwiDocument.getText(), /Uploaded from mirror\./);

    const revealPath = await vscode.commands.executeCommand<string>("kiwi.__test.revealLocalMirror");
    assert.equal(revealPath, redownloaded!.localPath);
  });

  it("does not auto-refresh opened case documents after local mirror upload when the editor is dirty", async function () {
    this.timeout(20000);
    const downloaded = await vscode.commands.executeCommand<{ localPath: string }>(
      "kiwi.__test.downloadLocalMirror"
    );
    assert.ok(downloaded?.localPath);
    await writeFile(
      downloaded!.localPath,
      `${await readFile(downloaded!.localPath, "utf8")}\n\nUploaded while editor is dirty.\n`,
      "utf8"
    );

    const kiwiUri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md");
    const kiwiDocument = await vscode.workspace.openTextDocument(kiwiUri);
    const editor = await vscode.window.showTextDocument(kiwiDocument);
    await editor.edit((editBuilder) => {
      editBuilder.insert(new vscode.Position(kiwiDocument.lineCount, 0), "\n\nDirty local draft.\n");
    });
    assert.equal(kiwiDocument.isDirty, true);

    const uploaded = await vscode.commands.executeCommand<{
      localPath: string;
      uploadedVersionToken: string;
    }>("kiwi.__test.uploadLocalMirror");
    assert.ok(uploaded?.uploadedVersionToken);
    assert.match((await harness.readState()).cases["501"]?.text ?? "", /Uploaded while editor is dirty\./);
    assert.match(kiwiDocument.getText(), /Dirty local draft\./);
    assert.doesNotMatch(kiwiDocument.getText(), /Uploaded while editor is dirty\./);

    await vscode.commands.executeCommand("workbench.action.files.revert");
  });

  it("keeps opened case documents stable until explicit refresh", async function () {
    this.timeout(20000);
    const uri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md");
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const initialText = document.getText();
    const initialStat = await vscode.workspace.fs.stat(uri);

    await harness.simulateRemoteChange(501, (current) => ({
      ...current,
      text: `${current.text}\n\nChanged remotely.`
    }));

    const statAfterRemoteChange = await vscode.workspace.fs.stat(uri);
    assert.equal(statAfterRemoteChange.mtime, initialStat.mtime);
    assert.equal(document.getText(), initialText);

    const freshness = await vscode.commands.executeCommand<{
      status: string;
      caseId: number;
    }>("kiwi.__test.checkCaseFreshness");
    assert.equal(freshness?.status, "stale");
    assert.equal(freshness?.caseId, 501);

    const snapshot = await vscode.commands.executeCommand<KiwiPlansTreeSnapshotNode[]>(
      "kiwi.__test.getPlanTreeSnapshot"
    );
    const caseNode = snapshot?.[0]?.children?.find((node) => node.label === "501 - Login works.md");
    assert.equal(caseNode?.description, "remote changed");

    await vscode.commands.executeCommand("kiwi.refreshPlans");
  });

  it("auto-checks freshness when the active kiwi editor changes", async function () {
    this.timeout(20000);
    const kiwiUri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md");
    const kiwiDocument = await vscode.workspace.openTextDocument(kiwiUri);
    await vscode.window.showTextDocument(kiwiDocument);

    await harness.simulateRemoteChange(501, (current) => ({
      ...current,
      text: `${current.text}\n\nAuto-checked remote change.`
    }));

    const scratch = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: "scratch"
    });
    await vscode.window.showTextDocument(scratch, { preview: false });
    await vscode.window.showTextDocument(kiwiDocument, { preview: false });

    await waitForTreeCaseDescription("501 - Login works.md", "remote changed");

    const refreshed = await vscode.commands.executeCommand<boolean>("kiwi.refreshCaseDocument");
    assert.equal(refreshed, true);

    await vscode.window.showTextDocument(scratch, { preview: false });
    await vscode.window.showTextDocument(kiwiDocument, { preview: false });

    await waitForTreeCaseDescription("501 - Login works.md", undefined);
    assert.match(kiwiDocument.getText(), /Auto-checked remote change\./);
  });

  it("refreshes active case documents only on explicit command", async function () {
    this.timeout(20000);
    const uri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md");
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    await harness.simulateRemoteChange(501, (current) => ({
      ...current,
      text: `${current.text}\n\nRefreshed explicitly.`
    }));

    assert.doesNotMatch(document.getText(), /Refreshed explicitly\./);

    const refreshed = await vscode.commands.executeCommand<boolean>("kiwi.refreshCaseDocument");
    assert.equal(refreshed, true);
    assert.match(document.getText(), /Refreshed explicitly\./);
  });

  it("uses the active dirty editor as the local diff baseline", async function () {
    this.timeout(20000);
    const uri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md");
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    await editor.edit((editBuilder) => {
      editBuilder.insert(new vscode.Position(document.lineCount, 0), "\n\nLocal-only edit.");
    });
    await harness.simulateRemoteChange(501, (current) => ({
      ...current,
      text: `${current.text}\n\nRemote-only edit.`
    }));

    const diffResult = await vscode.commands.executeCommand<{
      localUri: string;
      remoteUri: string;
      title: string;
    }>("kiwi.showCaseDiff");

    assert.ok(diffResult);
    const localDocument = await vscode.workspace.openTextDocument(vscode.Uri.parse(diffResult!.localUri));
    const remoteDocument = await vscode.workspace.openTextDocument(vscode.Uri.parse(diffResult!.remoteUri));
    assert.match(localDocument.getText(), /Local-only edit\./);
    assert.match(remoteDocument.getText(), /Remote-only edit\./);
    assert.match(document.getText(), /Local-only edit\./);

    await vscode.commands.executeCommand("workbench.action.files.revert");
  });

  it("rejects refresh when active case document is dirty", async function () {
    this.timeout(20000);
    const uri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/501 - Login works.md");
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    await editor.edit((editBuilder) => {
      editBuilder.insert(new vscode.Position(document.lineCount, 0), "\n\nLocal draft.");
    });
    assert.equal(document.isDirty, true);

    const refreshed = await vscode.commands.executeCommand<boolean>("kiwi.refreshCaseDocument");
    assert.equal(refreshed, false);
    assert.match(document.getText(), /Local draft\./);

    await vscode.commands.executeCommand("workbench.action.files.revert");
  });

  it("resolves runtime log directory from launch env", async function () {
    this.timeout(20000);
    const directory = await vscode.commands.executeCommand<string>("kiwi.__test.getResolvedRuntimeLogDirectory");
    assert.ok(directory);
    assert.equal(directory, path.dirname(process.env.KIWI_JSONL_PATH!));
  });

  it("rejects runtime log commands outside debug-f5 mode", async function () {
    this.timeout(20000);
    const originalRuntimeMode = process.env.KIWI_RUNTIME_MODE;
    try {
      process.env.KIWI_RUNTIME_MODE = "production";

      const removed = await vscode.commands.executeCommand<number>("kiwi.clearRuntimeLogs");
      const revealed = await vscode.commands.executeCommand("kiwi.revealRuntimeLogs");

      assert.equal(removed, 0);
      assert.equal(revealed, undefined);
    } finally {
      process.env.KIWI_RUNTIME_MODE = originalRuntimeMode;
    }
  });

  it("reveals kiwi plans without mutating workspace folders", async function () {
    this.timeout(20000);
    const before = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()) ?? [];

    const first = await vscode.commands.executeCommand<string>("kiwi.openRoot");
    const second = await vscode.commands.executeCommand<string>("kiwi.openRoot");
    const after = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()) ?? [];
    const snapshot = await vscode.commands.executeCommand<KiwiPlansTreeSnapshotNode[]>(
      "kiwi.__test.getPlanTreeSnapshot"
    );

    assert.equal(first, "kiwiPlans");
    assert.equal(second, "kiwiPlans");
    assert.deepEqual(after, before);
    assert.ok(snapshot);
    assert.equal(snapshot?.[0]?.label, "100 - Regression");
    assert.match(snapshot?.[0]?.children?.[0]?.label ?? "", /^501 - Login/);
    assert.match(snapshot?.[0]?.children?.[1]?.label ?? "", /^502 - Password reset/);
  });

  it("keeps provider directory listings cached until explicit refresh", async function () {
    this.timeout(20000);
    const uri = vscode.Uri.parse("kiwi:/plans/100 - Regression/cases/");
    const before = await vscode.workspace.fs.readDirectory(uri);
    assert.equal(before.some(([name]) => name === "503 - Added later.md"), false);

    await harness.seedCaseDocument({
      id: 503,
      planId: 100,
      summary: "Added later",
      priority: "P3",
      category: "Functional",
      status: "CONFIRMED",
      components: [],
      tags: [],
      notes: "",
      text: "Later body"
    });
    await harness.seedCaseHistory(503, [
      {
        historyId: 30,
        historyDate: "2026-04-05T00:00:00.000Z"
      }
    ]);
    await harness.seedPlanCases(100, [501, 502, 503]);

    const cached = await vscode.workspace.fs.readDirectory(uri);
    assert.equal(cached.some(([name]) => name === "503 - Added later.md"), false);

    await vscode.commands.executeCommand("kiwi.refreshPlans");
    const refreshed = await vscode.workspace.fs.readDirectory(uri);
    assert.equal(refreshed.some(([name]) => name === "503 - Added later.md"), true);
  });
});

async function waitForFile(pathname: string, retries = 20): Promise<string> {
  for (let index = 0; index < retries; index += 1) {
    try {
      return await readFile(pathname, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Timed out waiting for log file: ${pathname}`);
}

async function waitForFileMatching(
  pathname: string,
  pattern: RegExp,
  retries = 20
): Promise<string> {
  for (let index = 0; index < retries; index += 1) {
    const content = await waitForFile(pathname, 1);
    if (pattern.test(content)) {
      return content;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for pattern ${pattern} in ${pathname}`);
}

async function waitForDocumentContent(
  uri: vscode.Uri,
  pattern: RegExp,
  retries = 20
): Promise<vscode.TextDocument> {
  for (let index = 0; index < retries; index += 1) {
    const document = await vscode.workspace.openTextDocument(uri);
    if (pattern.test(document.getText())) {
      return document;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for document content: ${uri.toString()}`);
}

function getKiwifsExtension(): vscode.Extension<unknown> | undefined {
  return (
    vscode.extensions.getExtension("yyamamot.vscode-kiwifs") ??
    vscode.extensions.getExtension("local.kiwifs")
  );
}

async function waitForTreeCaseDescription(
  label: string,
  description: string | undefined,
  retries = 20
): Promise<void> {
  for (let index = 0; index < retries; index += 1) {
    const snapshot = await vscode.commands.executeCommand<KiwiPlansTreeSnapshotNode[]>(
      "kiwi.__test.getPlanTreeSnapshot"
    );
    const node = snapshot
      ?.flatMap((plan) => plan.children ?? [])
      .find((item) => item.label === label);
    if (node?.description === description) {
      return;
    }
    if (!node && description === undefined) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for tree description ${description ?? "<none>"} on ${label}`);
}

async function waitForTabState(uriString: string, expected: boolean, retries = 20): Promise<boolean> {
  for (let index = 0; index < retries; index += 1) {
    const current = hasTabForUri(uriString);
    if (current === expected) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for tab state ${expected} on ${uriString}`);
}

function hasTabForUri(uriString: string): boolean {
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => {
      if (tab.input instanceof vscode.TabInputText) {
        return tab.input.uri.toString() === uriString;
      }
      return false;
    })
  );
}
