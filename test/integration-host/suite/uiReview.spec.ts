import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { setTimeout as delay } from "node:timers/promises";
import { createKiwiHarness, KiwiHarness } from "../../harness/createKiwiHarness";
import type { CaseFilterFormState } from "../../../src/extension/caseFilter";
import type { UiReviewSnapshot } from "../../../src/harness/ui-review";

const execFileAsync = promisify(execFile);

type UiReviewScenario = {
  id: string;
  screen?: "case-filter" | "test-run-filter" | "treeview-context-menu";
  formState?: CaseFilterFormState | TestRunFilterFormState;
  targets?: TreeViewContextMenuTarget[];
  nativeContextMenus?: NativeContextMenuScenario[];
  interactions?: Array<
    | { type: "toggle-case-selection"; caseId: number; selected: boolean }
  >;
  expected?: {
    hasResults?: boolean;
    resultCount?: number;
    selectedCount?: number;
    resultIds?: number[];
    summaries?: string[];
  };
  requiredReviewIds?: string[];
};

type TreeViewContextMenuTarget = {
  name: string;
  kind: "plan" | "case";
  planId: number;
  caseId?: number;
};

type NativeContextMenuScenario = {
  name: string;
  target: string;
  setupCommands: Array<{ id: string; args?: unknown[]; pauseMs?: number }>;
  windowFrame?: { x: number; y: number; width: number; height: number };
  beforeOpenPauseMs?: number;
  afterOpenPauseMs?: number;
};

type TestRunFilterFormState = {
  query: string;
  planId: string;
  build: string;
};

describe("ui review host", () => {
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
    await harness.seedPlanCases(200, [601]);
    await harness.seedCaseHistory(501, [{ historyId: 11, historyDate: "2026-04-06T00:00:00.000Z" }]);
    await harness.seedCaseHistory(502, [{ historyId: 20, historyDate: "2026-04-05T00:00:00.000Z" }]);
    await harness.seedCaseHistory(601, [{ historyId: 30, historyDate: "2026-04-05T00:00:00.000Z" }]);
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

    process.env.KIWI_MOCK_STATE_PATH = harness.statePath;
    await vscode.workspace.getConfiguration("kiwi").update(
      "baseUrl",
      harness.baseUrl,
      vscode.ConfigurationTarget.Global
    );
    const extension = vscode.extensions.getExtension("yyamamot.vscode-kiwifs");
    assert.ok(extension);
    await extension.activate();
  });

  after(async function () {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      await rm(path.join(workspaceRoot, ".kiwi-mirror"), { recursive: true, force: true });
    }
  });

  it("captures case filter UI review artifacts", async function () {
    this.timeout(30000);
    const scenario = loadScenario();
    const paths = artifactPaths();
    const screen = scenario.screen ?? "case-filter";

    await mkdir(path.dirname(paths.snapshot), { recursive: true });
    await mkdir(path.dirname(paths.screenshot), { recursive: true });
    await mkdir(path.dirname(paths.workspaceState), { recursive: true });
    await mkdir(path.dirname(paths.commandTrace), { recursive: true });

    if (screen === "treeview-context-menu") {
      await captureTreeViewContextMenuArtifacts(scenario, paths);
      return;
    }

    const commandTrace: Array<{ stepId: string; command: string; args?: unknown[] }> = [];
    await runCommand(
      commandTrace,
      `open-${screen}`,
      screen === "test-run-filter" ? "kiwi.__test.filterTestRuns" : "kiwi.__test.filterCases"
    );
    const results = await runCommand(
      commandTrace,
      `submit-${screen}`,
      screen === "test-run-filter" ? "kiwi.__test.submitTestRunFilter" : "kiwi.__test.submitCaseFilter",
      [scenario.formState]
    ) as Array<{ id?: number; summary?: string; caseRef?: { id: number; summary: string } }>;
    assertScenarioResults(scenario, results);
    for (const interaction of scenario.interactions ?? []) {
      if (interaction.type === "toggle-case-selection") {
        await runCommand(
          commandTrace,
          `toggle-case-selection-${interaction.caseId}`,
          "kiwi.__test.toggleCaseFilterSelection",
          [interaction.caseId, interaction.selected]
        );
      }
    }
    await delay(500);

    const snapshot = await runCommand(
      commandTrace,
      "capture-ui-review-snapshot",
      screen === "test-run-filter"
        ? "kiwi.__test.captureTestRunFilterUiReviewSnapshot"
        : "kiwi.__test.captureCaseFilterUiReviewSnapshot",
      [scenario.id]
    ) as UiReviewSnapshot;
    assert.equal(snapshot.selfReview.screen, screen);
    if (scenario.expected?.hasResults !== undefined) {
      assert.equal(snapshot.selfReview.hasResults, scenario.expected.hasResults);
    }
    if (scenario.expected?.resultCount !== undefined) {
      assert.equal(snapshot.selfReview.resultCount, scenario.expected.resultCount);
    }
    if (scenario.expected?.selectedCount !== undefined) {
      assert.equal(snapshot.selfReview.selectedCount, scenario.expected.selectedCount);
    }
    for (const reviewId of scenario.requiredReviewIds ?? []) {
      assert.ok(
        snapshot.geometry.elements.some((element) => element.reviewId === reviewId),
        `missing review id: ${reviewId}`
      );
    }

    await writeJson(paths.snapshot, snapshot);
    await writeJson(paths.commandTrace, {
      scenarioId: scenario.id,
      commands: commandTrace
    });
    await writeJson(paths.workspaceState, {
      scenarioId: scenario.id,
      workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()) ?? [],
      activeTextEditor: vscode.window.activeTextEditor?.document.uri.toString()
    });
    await captureScreenshot(paths.screenshot);
  });
});

async function captureTreeViewContextMenuArtifacts(
  scenario: UiReviewScenario,
  paths: ReturnType<typeof artifactPaths>
): Promise<void> {
  const commandTrace: Array<{ stepId: string; command: string; args?: unknown[] }> = [];
  const uiStatePath = requireEnv("KIWIFS_UI_REVIEW_UI_STATE_PATH");
  const nativeContextMenuReportPath = requireEnv("KIWIFS_UI_REVIEW_NATIVE_CONTEXT_MENU_REPORT_PATH");
  const screenshotsRoot = path.dirname(paths.screenshot);
  const targets = scenario.targets ?? [];
  const actionSurfaces: Array<{
    target: string;
    title?: string;
    overview?: { rows?: Array<{ label: string; value: string }> };
    items: Array<{ id: string; category: string; label: string; command: string; mode: string }>;
    screenshot?: string;
  }> = [];

  await mkdir(path.dirname(uiStatePath), { recursive: true });
  for (const target of targets) {
    const treeNode = await runCommand(
      commandTrace,
      `reveal-tree-${target.name}`,
      "kiwi.__test.revealKiwiPlansTreeItem",
      [target, { select: true, focus: true, expand: 1 }]
    );
    await runCommand(
      commandTrace,
      `show-actions-${target.name}`,
      "kiwi.showTreeItemActions",
      [treeNode]
    );
    const state = await runCommand(
      commandTrace,
      `collect-actions-${target.name}`,
      "kiwi.__test.getTreeItemActionSurfaceState",
      [treeNode]
    ) as {
      title?: string;
      overview?: { rows?: Array<{ label: string; value: string }> };
      items: Array<{ id: string; category: string; label: string; command: string; mode: string }>;
    };
    await delay(500);
    const screenshot = path.join(screenshotsRoot, `action-surface-${target.name}.png`);
    await captureScreenshot(screenshot);
    actionSurfaces.push({ target: target.name, title: state.title, overview: state.overview, items: state.items, screenshot });
    await executeWorkbenchCommandIfAvailable("workbench.action.closeActiveEditor");
    await delay(250);
  }

  const nativeContextMenus = [];
  for (const nativeContextMenu of scenario.nativeContextMenus ?? []) {
    nativeContextMenus.push(await captureNativeContextMenuEvidence(
      nativeContextMenu,
      screenshotsRoot,
      commandTrace
    ));
  }

  const menus = await collectPackageMenus();
  await writeJson(uiStatePath, {
    capturedAt: new Date().toISOString(),
    scenarioId: scenario.id,
    menus,
    actionSurfaces,
    nativeContextMenus
  });
  await writeJson(nativeContextMenuReportPath, {
    scenarioId: scenario.id,
    nativeContextMenus
  });
  await writeJson(paths.commandTrace, {
    scenarioId: scenario.id,
    commands: commandTrace
  });
  await writeJson(paths.workspaceState, {
    scenarioId: scenario.id,
    workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()) ?? [],
    activeTextEditor: vscode.window.activeTextEditor?.document.uri.toString()
  });
}

function assertScenarioResults(
  scenario: UiReviewScenario,
  results: Array<{ id?: number; summary?: string; caseRef?: { id: number; summary: string } }>
): void {
  if (scenario.expected?.resultCount !== undefined) {
    assert.equal(results.length, scenario.expected.resultCount);
  }
  if (scenario.expected?.resultIds) {
    const actualIds = results.map((result) => result.caseRef?.id ?? result.id);
    assert.deepEqual(actualIds, scenario.expected.resultIds);
  }
  for (const summary of scenario.expected?.summaries ?? []) {
    assert.ok(
      results.some((result) => (result.caseRef?.summary ?? result.summary ?? "").includes(summary)),
      `missing summary: ${summary}`
    );
  }
}

async function runCommand(
  commandTrace: Array<{ stepId: string; command: string; args?: unknown[] }>,
  stepId: string,
  command: string,
  args: unknown[] = []
): Promise<unknown> {
  commandTrace.push({ stepId, command, args });
  return vscode.commands.executeCommand(command, ...args);
}

function loadScenario(): UiReviewScenario {
  const scenarioPath = process.env.KIWIFS_UI_REVIEW_SCENARIO_PATH;
  assert.ok(scenarioPath, "KIWIFS_UI_REVIEW_SCENARIO_PATH is required.");
  return require(scenarioPath) as UiReviewScenario;
}

function artifactPaths(): {
  snapshot: string;
  screenshot: string;
  workspaceState: string;
  commandTrace: string;
} {
  const snapshot = requireEnv("KIWIFS_UI_REVIEW_SNAPSHOT_PATH");
  const screenshot = requireEnv("KIWIFS_UI_REVIEW_SCREENSHOT_PATH");
  const workspaceState = requireEnv("KIWIFS_UI_REVIEW_WORKSPACE_STATE_PATH");
  const commandTrace = requireEnv("KIWIFS_UI_REVIEW_COMMAND_TRACE_PATH");
  return { snapshot, screenshot, workspaceState, commandTrace };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function collectPackageMenus(): Promise<{
  viewItemContext: Array<{ command: string; title?: string; when?: string; group?: string }>;
  commandPalette: Array<{ command: string; title?: string; when?: string; group?: string }>;
}> {
  const extension = vscode.extensions.getExtension("yyamamot.vscode-kiwifs");
  assert.ok(extension);
  const packageJson = JSON.parse(
    await readFile(path.join(extension.extensionPath, "package.json"), "utf8")
  ) as {
    contributes?: {
      commands?: Array<{ command: string; title?: string }>;
      menus?: {
        ["view/item/context"]?: Array<{ command: string; when?: string; group?: string }>;
        commandPalette?: Array<{ command: string; when?: string; group?: string }>;
      };
    };
  };
  const commands = new Map(
    (packageJson.contributes?.commands ?? []).map((entry) => [entry.command, entry])
  );
  const attachTitle = (entry: { command: string; when?: string; group?: string }) => ({
    command: entry.command,
    title: commands.get(entry.command)?.title,
    when: entry.when,
    group: entry.group
  });
  return {
    viewItemContext: (packageJson.contributes?.menus?.["view/item/context"] ?? []).map(attachTitle),
    commandPalette: (packageJson.contributes?.menus?.commandPalette ?? []).map(attachTitle)
  };
}

async function captureNativeContextMenuEvidence(
  nativeContextMenu: NativeContextMenuScenario,
  screenshotsRoot: string,
  commandTrace: Array<{ stepId: string; command: string; args?: unknown[] }>
): Promise<{
  name: string;
  target: string;
  status: "captured-unverified" | "capture-failed" | "not-supported";
  screenshot?: string;
  metadata?: string;
  reason?: string;
}> {
  const screenshot = path.join(screenshotsRoot, `native-context-menu-${nativeContextMenu.name}.png`);
  const metadata = captureMetadataPath(screenshot);
  if (process.platform !== "darwin") {
    return {
      name: nativeContextMenu.name,
      target: nativeContextMenu.target,
      status: "not-supported",
      reason: "Native context menu screenshot capture currently requires macOS."
    };
  }

  try {
    const boundsBeforeFrame = await getExtensionHostWindowBounds();
    if (!boundsBeforeFrame.ok) {
      throw new Error(boundsBeforeFrame.reason);
    }
    await focusProcess(boundsBeforeFrame.bounds.processId);
    if (nativeContextMenu.windowFrame) {
      await setProcessWindowFrame(boundsBeforeFrame.bounds.processId, nativeContextMenu.windowFrame);
      await delay(300);
    }

    for (const command of nativeContextMenu.setupCommands) {
      await runCommand(commandTrace, `native-setup-${nativeContextMenu.name}-${command.id}`, command.id, command.args ?? []);
      if (command.pauseMs) {
        await delay(command.pauseMs);
      }
    }
    if (nativeContextMenu.beforeOpenPauseMs) {
      await delay(nativeContextMenu.beforeOpenPauseMs);
    }
    await sendSystemEventsKeyCode(109, ["shift down"]);
    if (nativeContextMenu.afterOpenPauseMs) {
      await delay(nativeContextMenu.afterOpenPauseMs);
    }

    const bounds = await getExtensionHostWindowBounds();
    if (!bounds.ok) {
      throw new Error(bounds.reason);
    }
    const command = ["-x", "-R", formatWindowBounds(bounds.bounds), screenshot];
    await execFileAsync("screencapture", command, { timeout: 30000 });
    await sendSystemEventsKeyCode(53);
    await delay(1000);
    await writeJson(metadata, {
      captureMode: "window-region-with-native-menu",
      command: `screencapture ${command.slice(0, -1).join(" ")}`,
      bounds: bounds.bounds,
      capturedAt: new Date().toISOString()
    });
    return {
      name: nativeContextMenu.name,
      target: nativeContextMenu.target,
      status: "captured-unverified",
      screenshot,
      metadata
    };
  } catch (error) {
    try {
      await sendSystemEventsKeyCode(53);
    } catch {
      // best effort cleanup only
    }
    return {
      name: nativeContextMenu.name,
      target: nativeContextMenu.target,
      status: "capture-failed",
      screenshot,
      metadata,
      reason: errorMessage(error)
    };
  }
}

async function captureScreenshot(screenshotPath: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("UI review screenshot capture currently requires macOS screencapture.");
  }
  await delay(250);
  const bounds = await getExtensionHostWindowBounds();
  if (!bounds.ok) {
    throw new Error(`UI review screenshot active window was not found: ${bounds.reason}`);
  }

  await executeWorkbenchCommandIfAvailable("workbench.action.notifications.clearAll");
  await executeWorkbenchCommandIfAvailable("notifications.clearAll");
  await delay(250);

  const command = bounds.bounds.windowId
    ? ["-x", "-o", "-l", String(bounds.bounds.windowId), screenshotPath]
    : ["-x", "-R", formatWindowBounds(bounds.bounds), screenshotPath];
  await execFileAsync("screencapture", command, { timeout: 30000 });
  await writeJson(captureMetadataPath(screenshotPath), {
    captureMode: "active-window",
    command: `screencapture ${command.slice(0, -1).join(" ")}`,
    bounds: bounds.bounds,
    capturedAt: new Date().toISOString()
  });
}

type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  windowId?: number;
  processId?: number;
  title?: string;
  processName?: string;
};

type WindowBoundsResult =
  | { ok: true; bounds: WindowBounds }
  | { ok: false; reason: string };

async function getExtensionHostWindowBounds(): Promise<WindowBoundsResult> {
  const script = [
    "import CoreGraphics",
    "import Foundation",
    "",
    "let preferredTitles = [\"[Extension Development Host]\", \"[拡張機能開発ホスト]\", \"integration-host\", \"vscode-kiwifs-private\", \"テストケースを探す\"]",
    "let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]",
    "guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {",
    "  throw NSError(domain: \"kiwifs-ui-review\", code: 1, userInfo: [NSLocalizedDescriptionKey: \"CGWindowListCopyWindowInfo failed\"])",
    "}",
    "",
    "func number(_ value: Any?) -> Double? {",
    "  if let number = value as? NSNumber { return number.doubleValue }",
    "  return nil",
    "}",
    "",
    "func candidate(from window: [String: Any]) -> [String: Any]? {",
    "  let title = window[kCGWindowName as String] as? String ?? \"\"",
    "  let owner = window[kCGWindowOwnerName as String] as? String ?? \"\"",
    "  let layer = (window[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0",
    "  guard layer == 0 else { return nil }",
    "  guard owner == \"Code\" || owner == \"Visual Studio Code\" || owner == \"Electron\" else { return nil }",
    "  guard title.contains(\"[Extension Development Host]\") || title.contains(\"[拡張機能開発ホスト]\") else { return nil }",
    "  guard let bounds = window[kCGWindowBounds as String] as? [String: Any],",
    "    let x = number(bounds[\"X\"]),",
    "    let y = number(bounds[\"Y\"]),",
    "    let width = number(bounds[\"Width\"]),",
    "    let height = number(bounds[\"Height\"]),",
    "    let id = (window[kCGWindowNumber as String] as? NSNumber)?.intValue,",
    "    let pid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.intValue else { return nil }",
    "  guard width > 0 && height > 0 else { return nil }",
    "  let preferredRank = preferredTitles.firstIndex { title.contains($0) } ?? 100",
    "  let sizeRank = (width >= 900 && height >= 700) ? 10 : 50",
    "  return [",
    "    \"rank\": preferredRank + sizeRank,",
    "    \"windowId\": id,",
    "    \"processId\": pid,",
    "    \"processName\": owner,",
    "    \"title\": title,",
    "    \"x\": Int(x.rounded()),",
    "    \"y\": Int(y.rounded()),",
    "    \"width\": Int(width.rounded()),",
    "    \"height\": Int(height.rounded())",
    "  ]",
    "}",
    "",
    "let candidates = windows.compactMap(candidate).sorted {",
    "  let lhs = $0[\"rank\"] as? Int ?? 999",
    "  let rhs = $1[\"rank\"] as? Int ?? 999",
    "  return lhs < rhs",
    "}",
    "",
    "guard var selected = candidates.first else {",
    "  throw NSError(domain: \"kiwifs-ui-review\", code: 2, userInfo: [NSLocalizedDescriptionKey: \"No Extension Development Host window candidate found\"])",
    "}",
    "selected.removeValue(forKey: \"rank\")",
    "let data = try JSONSerialization.data(withJSONObject: selected, options: [])",
    "FileHandle.standardOutput.write(data)"
  ].join("\n");

  try {
    const { stdout } = await execFileAsync("/usr/bin/swift", ["-e", script], { timeout: 30000 });
    return parseWindowBounds(stdout);
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

async function focusProcess(processId: number | undefined): Promise<void> {
  if (!processId) {
    return;
  }
  await execFileAsync("osascript", [
    "-e",
    `tell application "System Events" to set frontmost of first process whose unix id is ${processId} to true`
  ], { timeout: 10000 });
}

async function setProcessWindowFrame(
  processId: number | undefined,
  frame: { x: number; y: number; width: number; height: number }
): Promise<void> {
  if (!processId) {
    return;
  }
  await execFileAsync("osascript", [
    "-e",
    [
      "tell application \"System Events\"",
      `  tell first process whose unix id is ${processId}`,
      `    set position of window 1 to {${frame.x}, ${frame.y}}`,
      `    set size of window 1 to {${frame.width}, ${frame.height}}`,
      "  end tell",
      "end tell"
    ].join("\n")
  ], { timeout: 10000 });
}

async function sendSystemEventsKeyCode(
  keyCode: number,
  modifiers: string[] = []
): Promise<void> {
  const modifierClause = modifiers.length > 0 ? ` using {${modifiers.join(", ")}}` : "";
  await execFileAsync("osascript", [
    "-e",
    `tell application "System Events" to key code ${keyCode}${modifierClause}`
  ], { timeout: 10000 });
}

function parseWindowBounds(stdout: string): WindowBoundsResult {
  const text = stdout.trim();
  if (!text) {
    return { ok: false, reason: "window bounds swift returned empty output" };
  }

  let parsed: Partial<WindowBounds>;
  try {
    parsed = JSON.parse(text) as Partial<WindowBounds>;
  } catch {
    return { ok: false, reason: `window bounds output has unexpected shape: ${text}` };
  }

  const { x, y, width, height, windowId, processId, title, processName } = parsed;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return { ok: false, reason: `window bounds rectangle is invalid: ${text}` };
  }
  if (width <= 0 || height <= 0) {
    return { ok: false, reason: `window bounds rectangle is out of range: ${text}` };
  }

  return {
    ok: true,
    bounds: {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      ...(typeof windowId === "number" ? { windowId } : {}),
      ...(typeof processId === "number" ? { processId } : {}),
      ...(title ? { title } : {}),
      ...(processName ? { processName } : {})
    }
  };
}

function formatWindowBounds(bounds: WindowBounds): string {
  return `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
}

function captureMetadataPath(screenshotPath: string): string {
  return screenshotPath.replace(/\.png$/i, ".capture.json");
}

async function executeWorkbenchCommandIfAvailable(command: string): Promise<boolean> {
  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes(command)) {
    return false;
  }
  await vscode.commands.executeCommand(command);
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  assert.ok(value, `${name} is required.`);
  return value;
}
