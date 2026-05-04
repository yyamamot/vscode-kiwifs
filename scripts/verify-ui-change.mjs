#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);

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

const unitTests = [
  "test/unit/uiReview.test.ts",
  "test/unit/caseFilter.test.ts",
  "test/unit/buildCaseSearchQuickPickItems.test.ts"
];

runRequired("pnpm", ["exec", "vitest", "run", ...unitTests], "UI-related unit tests");
runRequired("pnpm", ["run", "test:integration:host"], "VS Code host integration");
const review = runRequired(
  "pnpm",
  ["run", "review:ui:feature", "--", "--scenario", options.scenario, "--id", options.id],
  "feature UI review"
);

const reviewOutput = `${review.stdout}\n${review.stderr}`;
const reviewPack = parseLastMatch(reviewOutput, /^ui review pack:\s*(.+)$/gmu);
const reviewResult = parseLastMatch(reviewOutput, /^ui review result:\s*(.+)$/gmu);
if (!reviewPack || !reviewResult) {
  console.error("Could not parse UI review pack path or result from review:ui:feature output.");
  process.exit(1);
}

const reportPath = join(reviewPack, "ui-review-report.json");
if (!existsSync(reportPath)) {
  console.error(`UI review report was not found: ${reportPath}`);
  process.exit(1);
}
const report = JSON.parse(readFileSync(reportPath, "utf8"));
if (report.result !== "pass" || reviewResult !== "pass") {
  console.error(`UI review did not pass: output=${reviewResult}, report=${report.result}`);
  console.error(`UI review pack: ${reviewPack}`);
  process.exit(1);
}

console.log("");
console.log("verify:ui-change result: pass");
console.log(`ui review pack: ${reviewPack}`);
console.log(`ui review result: ${report.result}`);

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

function runRequired(command, args, label) {
  console.log(`\n[verify:ui-change] ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    console.error(`[verify:ui-change] ${label} failed with exit code ${result.status ?? 1}.`);
    process.exit(result.status ?? 1);
  }
  return result;
}

function parseLastMatch(text, regex) {
  let value = "";
  for (const match of text.matchAll(regex)) {
    value = match[1]?.trim() ?? "";
  }
  return value;
}

function printUsage(exitCode) {
  console.log([
    "Usage: pnpm run verify:ui-change -- --scenario <scenario-id-or-path> --id <feature-id>",
    "",
    "Runs UI-related unit tests, VS Code host integration, and the feature UI review pack.",
    "",
    "Scenario aliases:",
    "  case-filter | case-filter-smoke | case-filter-body | case-filter-metadata | case-filter-selected | case-filter-empty",
    "  test-run-filter | test-run-filter-smoke | test-run-filter-empty",
    "  treeview-context-menu",
    "  smoke",
    "",
    "Example:",
    "  pnpm run verify:ui-change -- --scenario case-filter --id case-filter-smoke"
  ].join("\n"));
  process.exit(exitCode);
}
