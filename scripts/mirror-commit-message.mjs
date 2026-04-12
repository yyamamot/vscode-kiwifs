import { spawnSync } from "node:child_process";

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const error = result.stderr.trim() || result.stdout.trim();
    throw new Error(error || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function listChangedFiles() {
  const output = runGit([
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
  ]);
  return output
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

function detectBucket(file) {
  if (
    file === "README.md" ||
    file === "LICENSE" ||
    file === "LICENSE.txt" ||
    file === ".env.example"
  ) {
    return "readme";
  }
  if (file.startsWith("src/")) {
    return "extension";
  }
  if (file.startsWith("test/")) {
    return "test";
  }
  if (file.startsWith("assets/")) {
    return "assets";
  }
  if (file.startsWith("scripts/")) {
    return "scripts";
  }
  if (
    file === "package.json" ||
    file === "pnpm-lock.yaml" ||
    file === ".vscodeignore" ||
    file === ".gitignore" ||
    file === "tsconfig.json" ||
    file === "biome.json" ||
    file === "Makefile"
  ) {
    return "repo";
  }
  return "repo";
}

function summarizeBuckets(buckets) {
  const unique = [...new Set(buckets)];
  if (unique.length !== 1) {
    return {
      type: "chore",
      scope: "repo",
      summary: "public mirrorへ変更差分を同期",
    };
  }

  switch (unique[0]) {
    case "readme":
      return {
        type: "docs",
        scope: "readme",
        summary: "public mirrorへ公開文書と設定例を同期",
      };
    case "extension":
      return {
        type: "chore",
        scope: "extension",
        summary: "public mirrorへ拡張本体の変更差分を同期",
      };
    case "test":
      return {
        type: "test",
        scope: "mirror",
        summary: "public mirrorへテスト差分を同期",
      };
    case "assets":
      return {
        type: "chore",
        scope: "assets",
        summary: "public mirrorへ画像資産の変更差分を同期",
      };
    case "scripts":
      return {
        type: "chore",
        scope: "scripts",
        summary: "public mirrorへ補助scriptの変更差分を同期",
      };
    default:
      return {
        type: "chore",
        scope: "repo",
        summary: "public mirrorへ設定変更を同期",
      };
  }
}

const changedFiles = listChangedFiles();

if (changedFiles.length === 0) {
  process.exit(0);
}

const message = summarizeBuckets(changedFiles.map(detectBucket));
process.stdout.write(`${message.type}(${message.scope}): ${message.summary}`);
