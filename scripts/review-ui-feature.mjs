#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const scenarioAliases = new Map([
  ["case-filter", [
    "fixtures/ui-review/case-filter-smoke/scenario.json",
    "fixtures/ui-review/case-filter-body/scenario.json",
    "fixtures/ui-review/case-filter-metadata/scenario.json",
    "fixtures/ui-review/case-filter-selected/scenario.json",
    "fixtures/ui-review/case-filter-empty/scenario.json"
  ]],
  ["case-filter-smoke", ["fixtures/ui-review/case-filter-smoke/scenario.json"]],
  ["case-filter-body", ["fixtures/ui-review/case-filter-body/scenario.json"]],
  ["case-filter-metadata", ["fixtures/ui-review/case-filter-metadata/scenario.json"]],
  ["case-filter-selected", ["fixtures/ui-review/case-filter-selected/scenario.json"]],
  ["case-filter-empty", ["fixtures/ui-review/case-filter-empty/scenario.json"]],
  ["test-run-filter", [
    "fixtures/ui-review/test-run-filter-smoke/scenario.json",
    "fixtures/ui-review/test-run-filter-empty/scenario.json"
  ]],
  ["test-run-filter-smoke", ["fixtures/ui-review/test-run-filter-smoke/scenario.json"]],
  ["test-run-filter-empty", ["fixtures/ui-review/test-run-filter-empty/scenario.json"]],
  ["treeview-context-menu", ["fixtures/ui-review/treeview-context-menu/scenario.json"]],
  ["smoke", [
    "fixtures/ui-review/case-filter-smoke/scenario.json",
    "fixtures/ui-review/test-run-filter-smoke/scenario.json",
    "fixtures/ui-review/treeview-context-menu/scenario.json"
  ]]
]);

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  printUsage(2);
}
if (options.help) {
  printUsage(0);
}
if (!options.scenario || !options.id) {
  printUsage(2);
}

const scenarioPaths = resolveScenarioPaths(options.scenario);
const reviewRoot = resolve(
  root,
  process.env.KIWIFS_UI_REVIEW_PACK_ROOT ||
    join(".tmp", "ui-review-pack", `ui-review-${new Date().toISOString().replace(/[:.]/g, "-")}`)
);

for (const scenarioPath of scenarioPaths) {
  const scenario = readJson(resolve(root, scenarioPath));
  const scenarioId = scenarioPaths.length === 1
    ? options.id
    : `${options.id}-${scenario.id || basename(scenarioPath, ".json")}`;
  const result = spawnSync("pnpm", ["run", "review:ui:llm:scenario"], {
    cwd: root,
    env: {
      ...process.env,
      KIWIFS_UI_REVIEW_PACK_ROOT: reviewRoot,
      KIWIFS_UI_REVIEW_SCENARIO_PATH: scenarioPath,
      KIWIFS_UI_REVIEW_ID: scenarioId
    },
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveScenarioPaths(scenario) {
  const aliased = scenarioAliases.get(scenario);
  const paths = aliased ?? [scenario];
  for (const scenarioPath of paths) {
    if (!existsSync(resolve(root, scenarioPath))) {
      throw new Error(`UI review scenario was not found: ${scenarioPath}`);
    }
  }
  return paths;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--scenario") {
      parsed.scenario = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--id") {
      parsed.id = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function printUsage(exitCode) {
  console.log([
    "Usage: pnpm run review:ui:feature -- --scenario <scenario-id-or-path> --id <feature-id>",
    "",
    "Scenario aliases:",
    "  case-filter | case-filter-smoke | case-filter-body | case-filter-metadata | case-filter-selected | case-filter-empty",
    "  test-run-filter | test-run-filter-smoke | test-run-filter-empty",
    "  treeview-context-menu",
    "  smoke",
    "",
    "Example:",
    "  pnpm run review:ui:feature -- --scenario case-filter --id case-filter-smoke"
  ].join("\n"));
  process.exit(exitCode);
}
