#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const runId = `ui-review-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const reviewRoot = resolve(
  root,
  process.env.KIWIFS_UI_REVIEW_PACK_ROOT || join(".tmp", "ui-review-pack", runId)
);
const scenarioPath = resolve(root, process.env.KIWIFS_UI_REVIEW_SCENARIO_PATH || "fixtures/ui-review/case-filter-smoke/scenario.json");
const scenario = readJson(scenarioPath);
const scenarioId = process.env.KIWIFS_UI_REVIEW_ID || scenario.id || basename(scenarioPath, ".json");
const scenariosRoot = join(reviewRoot, "scenarios");
const scenarioRoot = join(scenariosRoot, scenarioId);
const scenarioScreenshotsRoot = join(scenarioRoot, "screenshots");
const screenshotsRoot = join(reviewRoot, "screenshots");
const snapshotPath = join(scenarioRoot, "ui-review-snapshot.json");
const screenshotPath = join(scenarioScreenshotsRoot, "screen-1.png");
const copiedScreenshotPath = join(screenshotsRoot, `${scenarioId}.png`);
const runtimeJsonlPath = join(reviewRoot, "runtime.jsonl");
const harnessJsonlPath = join(reviewRoot, "harness.jsonl");
const workspaceStatePath = join(reviewRoot, "workspace-state.json");
const commandTracePath = join(reviewRoot, "command-trace.json");
const uiStatePath = join(scenarioRoot, "ui-state.json");
const nativeContextMenuReportPath = join(scenarioRoot, "native-context-menu-report.json");

main();

function main() {
  mkdirSync(scenarioScreenshotsRoot, { recursive: true });
  mkdirSync(screenshotsRoot, { recursive: true });
  writeHarnessEvent("harness.run.started", "started");

  run("pnpm", ["run", "build"]);
  run("pnpm", ["run", "build:test"]);
  const hostEnv = {
    ...process.env,
    KIWIFS_HOST_SUITE_MODE: "ui-review",
    KIWIFS_UI_REVIEW_SCENARIO_PATH: scenarioPath,
    KIWIFS_UI_REVIEW_SNAPSHOT_PATH: snapshotPath,
    KIWIFS_UI_REVIEW_SCREENSHOT_PATH: screenshotPath,
    KIWIFS_UI_REVIEW_WORKSPACE_STATE_PATH: workspaceStatePath,
    KIWIFS_UI_REVIEW_COMMAND_TRACE_PATH: commandTracePath,
    KIWIFS_UI_REVIEW_UI_STATE_PATH: uiStatePath,
    KIWIFS_UI_REVIEW_NATIVE_CONTEXT_MENU_REPORT_PATH: nativeContextMenuReportPath,
    KIWI_JSONL_PATH: runtimeJsonlPath
  };
  try {
    run("node", ["./out/test/integration-host/run.js"], hostEnv);
  } catch (error) {
    if (scenario.screen !== "treeview-context-menu" || !existsSync(uiStatePath)) {
      throw error;
    }
    console.error(`UI review host exited non-zero after generating TreeView artifacts: ${error.message}`);
  }

  if (scenario.screen === "treeview-context-menu") {
    finishTreeViewContextMenuScenario();
    return;
  }

  if (!existsSync(snapshotPath)) {
    throw new Error(`UI review snapshot was not generated: ${snapshotPath}`);
  }
  if (!existsSync(screenshotPath)) {
    throw new Error(`UI review screenshot was not generated: ${screenshotPath}`);
  }
  copyFileSync(screenshotPath, copiedScreenshotPath);

  const uiReview = require(join(root, "out", "src", "harness", "ui-review.js"));
  const snapshot = readJson(snapshotPath);
  const checks = uiReview.evaluateUiReviewSnapshot(snapshot);
  const result = uiReview.resultForUiReviewChecks(checks);
  const scenarioGeometry = { ...snapshot.geometry, checks };
  writeJson(join(scenarioRoot, "ui-geometry.json"), scenarioGeometry);
  writeJson(join(scenarioRoot, "llm-ui-self-review.json"), snapshot.selfReview ?? {});
  writeJson(join(reviewRoot, "ui-geometry.json"), {
    ...readJsonIfExists(join(reviewRoot, "ui-geometry.json"), {}),
    [scenarioId]: scenarioGeometry
  });
  writeJson(join(reviewRoot, "llm-ui-self-review.json"), {
    ...readJsonIfExists(join(reviewRoot, "llm-ui-self-review.json"), {}),
    [scenarioId]: snapshot.selfReview ?? {}
  });

  const scenarioResult = {
    id: scenarioId,
    result,
    checks,
    artifactPaths: {
      scenarioRoot,
      screenshot: copiedScreenshotPath,
      snapshot: snapshotPath
    }
  };
  const existingReport = readJsonIfExists(join(reviewRoot, "ui-review-report.json"), undefined);
  const existingScenarioResults = Array.isArray(existingReport?.scenarioResults)
    ? existingReport.scenarioResults.filter((item) => item.id !== scenarioId)
    : [];
  const report = uiReview.createUiReviewReport([
    ...existingScenarioResults,
    scenarioResult
  ], {
    ...(existingReport?.artifactPaths ?? {}),
    reviewRoot,
    screenshots: screenshotsRoot,
    scenarios: scenariosRoot,
    runtimeJsonl: runtimeJsonlPath,
    harnessJsonl: harnessJsonlPath,
    workspaceState: workspaceStatePath,
    commandTrace: commandTracePath
  });
  writeJson(join(reviewRoot, "ui-review-report.json"), report);
  writeFileSync(join(reviewRoot, "ui-review-prompt.md"), createPrompt(report), "utf8");
  writeHarnessEvent("harness.run.finished", report.result === "pass" ? "succeeded" : "failed");

  console.log("");
  console.log(`ui review pack: ${reviewRoot}`);
  console.log(`ui review result: ${report.result}`);
  if (report.result !== "pass") {
    process.exitCode = 1;
  }
}

function finishTreeViewContextMenuScenario() {
  if (!existsSync(uiStatePath)) {
    throw new Error(`UI review state was not generated: ${uiStatePath}`);
  }
  copyScenarioScreenshots();
  const uiReview = require(join(root, "out", "src", "harness", "ui-review.js"));
  const uiState = readJson(uiStatePath);
  const checks = uiReview.evaluateTreeViewContextMenuState(uiState);
  const result = uiReview.resultForUiReviewChecks(checks);
  const nativeContextMenus = existsSync(nativeContextMenuReportPath)
    ? readJson(nativeContextMenuReportPath).nativeContextMenus ?? []
    : [];

  writeJson(join(reviewRoot, "ui-state.json"), {
    ...readJsonIfExists(join(reviewRoot, "ui-state.json"), {}),
    [scenarioId]: uiState
  });

  const scenarioResult = {
    id: scenarioId,
    result,
    checks,
    evidenceLayers: scenario.evidenceLayers ?? [],
    nativeContextMenus,
    artifactPaths: {
      scenarioRoot,
      uiState: uiStatePath,
      nativeContextMenuReport: nativeContextMenuReportPath
    }
  };
  const existingReport = readJsonIfExists(join(reviewRoot, "ui-review-report.json"), undefined);
  const existingScenarioResults = Array.isArray(existingReport?.scenarioResults)
    ? existingReport.scenarioResults.filter((item) => item.id !== scenarioId)
    : [];
  const report = uiReview.createUiReviewReport([
    ...existingScenarioResults,
    scenarioResult
  ], {
    ...(existingReport?.artifactPaths ?? {}),
    reviewRoot,
    screenshots: screenshotsRoot,
    scenarios: scenariosRoot,
    uiState: join(reviewRoot, "ui-state.json"),
    runtimeJsonl: runtimeJsonlPath,
    harnessJsonl: harnessJsonlPath,
    workspaceState: workspaceStatePath,
    commandTrace: commandTracePath
  });
  writeJson(join(reviewRoot, "ui-review-report.json"), report);
  writeFileSync(join(reviewRoot, "ui-review-prompt.md"), createPrompt(report), "utf8");
  writeHarnessEvent("harness.run.finished", report.result === "pass" ? "succeeded" : "failed");

  console.log("");
  console.log(`ui review pack: ${reviewRoot}`);
  console.log(`ui review result: ${report.result}`);
  if (report.result !== "pass") {
    process.exitCode = 1;
  }
}

function copyScenarioScreenshots() {
  if (!existsSync(scenarioScreenshotsRoot)) {
    return;
  }
  for (const filename of readdirSync(scenarioScreenshotsRoot)) {
    if (!filename.endsWith(".png") && !filename.endsWith(".json")) {
      continue;
    }
    copyFileSync(
      join(scenarioScreenshotsRoot, filename),
      join(screenshotsRoot, `${scenarioId}.${filename}`)
    );
  }
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath, fallback) {
  return existsSync(filePath) ? readJson(filePath) : fallback;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeHarnessEvent(event, outcome) {
  mkdirSync(reviewRoot, { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    runId,
    scenarioId,
    outcome
  });
  writeFileSync(harnessJsonlPath, `${line}\n`, { flag: "a" });
}

function createPrompt(report) {
  return [
    "# LLM UI Review Prompt",
    "",
    "Review this kiwifs UI evidence pack.",
    "",
    "## Inputs",
    "",
    "- Read `ui-review-report.json` first.",
    "- Use `llm-ui-self-review.json` and `ui-geometry.json` for logical UI state and geometry.",
    "- Inspect screenshots under `screenshots/` for visual confirmation.",
    "- Per-scenario raw artifacts are under `scenarios/<scenario-id>/`.",
    "- For TreeView context menu scenarios, Layer 3 deterministic menu evidence is the source of truth, Layer 2 Quick Pick screenshots are stable visual evidence, and Layer 1 native screenshots are supporting evidence only.",
    "",
    "## Checklist",
    "",
    "- Required UI regions are visible: shell, filter form, result list, bulk actions.",
    "- Button, input, and select labels are not clipped.",
    "- Major UI regions do not overflow their own bounds.",
    "- Visible elements stay inside the viewport.",
    "- Search results remain readable in Japanese VS Code Webview styling.",
    "",
    "## Deterministic Result",
    "",
    `- result: ${report.result}`,
    `- findings: ${report.findings.length}`,
    "",
    "## Final Response Template",
    "",
    "- Result: pass / needs-fix / human-review",
    "- Evidence: screenshots and JSON files checked",
    "- Findings: severity, area, summary, suggested fix",
    "- Human review needed: only focus behavior, hover timing, native VS Code behavior, or long-session comfort",
    ""
  ].join("\n");
}
