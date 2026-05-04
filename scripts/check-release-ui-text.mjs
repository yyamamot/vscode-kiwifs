#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const targets = [
  "package.json",
  "src/extension",
  "src/provider",
  "src/domain"
];
const japanesePattern = /[\u3040-\u30ff\u3400-\u9fff]/;
const allowed = [
  {
    file: "src/extension/buildCaseSearchQuickPickItems.ts",
    text: "\"本文:\"",
    reason: "Backward-compatible hidden input alias for body search."
  }
];

const findings = [];
for (const target of targets) {
  for (const file of listFiles(target)) {
    const text = readFileSync(join(root, file), "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!japanesePattern.test(line)) {
        return;
      }
      if (allowed.some((entry) => entry.file === file && line.includes(entry.text))) {
        return;
      }
      findings.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
}

if (findings.length > 0) {
  console.error("release UI text check failed: Japanese text remains in release-visible source.");
  for (const finding of findings) {
    console.error(finding);
  }
  process.exit(1);
}

console.log("release UI text check passed.");

function listFiles(target) {
  const absolute = join(root, target);
  const stat = statSync(absolute);
  if (stat.isFile()) {
    return [target];
  }
  const entries = readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = `${target}/${entry.name}`;
    if (entry.isDirectory()) {
      return listFiles(child);
    }
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".json"))
      ? [child]
      : [];
  }).sort();
}
