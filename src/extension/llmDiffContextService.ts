import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { LocalMirrorScmResource, LocalMirrorScmState, UriLike } from "./localMirrorSourceControl";
import { type LlmPromptUiLabels } from "./llmSkillPackTemplates";

export interface LlmDiffContextResult {
  files: string[];
  resourceCount: number;
  promptPath: string;
  warnings: string[];
}

export interface LlmDiffContextStateResource {
  planId: number;
  planName: string;
  caseId: number;
  caseSummary: string;
  status: LocalMirrorScmResource["status"];
  localPath: string;
  changedFile?: string;
  patchPath?: string;
  patchStatus?: "changed" | "unchanged";
  warning?: string;
  applyCandidate: boolean;
}

export interface LlmDiffContextState {
  target: LocalMirrorScmState["target"];
  generatedAt: string;
  resources: LlmDiffContextStateResource[];
  warnings: string[];
}

export interface LlmDiffContextOptions {
  now?: Date;
  readResourceText?: (resource: LocalMirrorScmResource, side: "local" | "remote") => Promise<string>;
  uiLabels?: LlmPromptUiLabels;
}

const DEFAULT_DIFF_UI_LABELS: LlmPromptUiLabels = {
  kiwiApply: "Apply to Kiwi",
  takeRemote: "Take Remote Changes"
};
const DEFAULT_COMPARE_AGAIN_LABEL = "Check diffs or Compare Again";

const DIFF_CONTEXT_DIR = path.join(".kiwi-agent", "diff", "current");

export async function createLlmLocalMirrorDiffContext(
  workspaceRoot: string,
  state: LocalMirrorScmState | undefined,
  options: LlmDiffContextOptions = {}
): Promise<LlmDiffContextResult> {
  if (!state || state.resources.length === 0) {
    throw new Error(`No local mirror SCM snapshot. Run ${DEFAULT_COMPARE_AGAIN_LABEL} first.`);
  }

  const now = options.now ?? new Date();
  const readText = options.readResourceText ?? readResourceTextFromFileSystem;
  const contextState: LlmDiffContextState = {
    target: state.target,
    generatedAt: now.toISOString(),
    resources: [],
    warnings: []
  };
  const written: string[] = [];
  const changedFiles: string[] = [];

  for (const resource of state.resources) {
    const changedFile = normalizeChangedFile(workspaceRoot, resource.localPath);
    const stateResource: LlmDiffContextStateResource = {
      planId: resource.plan.id,
      planName: resource.plan.name,
      caseId: resource.caseRef.id,
      caseSummary: resource.caseRef.summary,
      status: resource.status,
      localPath: resource.localPath,
      changedFile,
      applyCandidate: resource.status === "LocalChanged" || resource.status === "Conflict"
    };
    if (changedFile) {
      changedFiles.push(changedFile);
    }

    try {
      const remoteText = await readText(resource, "remote");
      const localText = await readText(resource, "local");
      const patchPath = path.join(
        DIFF_CONTEXT_DIR,
        "diffs",
        `${resource.plan.id}-${resource.caseRef.id}.patch`
      );
      await writePackFile(
        workspaceRoot,
        patchPath,
        renderUnifiedPatch({
          fromFile: `remote/${resource.caseRef.id}.md`,
          toFile: changedFile ?? `local/${resource.caseRef.id}.md`,
          fromText: remoteText,
          toText: localText
        })
      );
      written.push(patchPath);
      stateResource.patchPath = patchPath;
      stateResource.patchStatus = remoteText === localText ? "unchanged" : "changed";
    } catch (error) {
      const warning = `Failed to generate patch for case ${resource.caseRef.id}: ${errorMessage(error)}`;
      stateResource.warning = warning;
      contextState.warnings.push(warning);
    }
    contextState.resources.push(stateResource);
  }

  const uniqueChangedFiles = [...new Set(changedFiles)].sort((left, right) => left.localeCompare(right));
  const artifactFiles = [
    {
      relativePath: path.join(DIFF_CONTEXT_DIR, "scm-state.json"),
      content: `${JSON.stringify(contextState, null, 2)}\n`
    },
    {
      relativePath: path.join(DIFF_CONTEXT_DIR, "changed-files.txt"),
      content: uniqueChangedFiles.length > 0 ? `${uniqueChangedFiles.join("\n")}\n` : ""
    },
    {
      relativePath: path.join(DIFF_CONTEXT_DIR, "prompt.md"),
      content: renderDiffPrompt(contextState, uniqueChangedFiles, options.uiLabels)
    }
  ];
  for (const artifact of artifactFiles) {
    await writePackFile(workspaceRoot, artifact.relativePath, artifact.content);
    written.push(artifact.relativePath);
  }

  return {
    files: written,
    resourceCount: state.resources.length,
    promptPath: path.join(DIFF_CONTEXT_DIR, "prompt.md"),
    warnings: [...contextState.warnings]
  };
}

export async function readCurrentLlmLocalMirrorDiffPrompt(workspaceRoot: string): Promise<string> {
  return readFile(path.join(workspaceRoot, DIFF_CONTEXT_DIR, "prompt.md"), "utf8");
}

function normalizeChangedFile(workspaceRoot: string, localPath: string): string | undefined {
  const relativePath = path.relative(workspaceRoot, path.isAbsolute(localPath) ? localPath : path.resolve(workspaceRoot, localPath));
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }
  const normalized = relativePath.split(path.sep).join("/");
  return normalized.startsWith(".kiwi-mirror/") && normalized.endsWith(".md") ? normalized : undefined;
}

async function writePackFile(workspaceRoot: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function readResourceTextFromFileSystem(
  resource: LocalMirrorScmResource,
  side: "local" | "remote"
): Promise<string> {
  if (side === "local") {
    return readFile(resource.localPath, "utf8");
  }
  return readFile(uriLikePath(resource.remoteUri), "utf8");
}

function uriLikePath(uri: UriLike): string {
  return uri.fsPath ?? uri.path;
}

function renderDiffPrompt(
  state: LlmDiffContextState,
  changedFiles: readonly string[],
  labels: LlmPromptUiLabels = DEFAULT_DIFF_UI_LABELS
): string {
  return `$kiwi-local-mirror-diff

If your LLM does not support $skill syntax, read .agents/skills/kiwi-local-mirror-diff/SKILL.md directly.
See also .agents/skills/kiwi-local-mirror-diff/agents/generic.md for step-by-step context setup.

You are reading kiwifs local mirror SCM diff context.

Inputs:

- .kiwi-agent/diff/current/scm-state.json
- .kiwi-agent/diff/current/changed-files.txt
- .kiwi-agent/diff/current/diffs/*.patch
- .agents/skills/kiwi-local-mirror-diff/SKILL.md

Changed files:

${changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`).join("\n") : "- No .kiwi-mirror Markdown files were listed."}

Diff reading goals:

- Summarize meaningful test case body changes.
- Identify risky assumptions, accidental removals, and conflict risks.
- Treat scm-state resources with patchStatus=unchanged as successfully generated no-change patches, not generation failures.
- Treat RemoteChanged resources as Kiwi-side update warnings, not apply candidates.
- For Conflict resources, explain what needs human merge review.
- Do not call Kiwi APIs, SCM commands, upload commands, take-remote commands, or remote apply commands.
- Do not run the Kiwi Apply command or Take Remote command, including the current UI command labels \`${labels.kiwiApply}\` and \`${labels.takeRemote}\`.
- Do not perform secret scanning. If wiki text contains secrets or passwords, report that wiki operation/policy should be fixed.
- End with human check points before the user decides whether to run the Kiwi Apply command.

Resource counts:

- LocalChanged: ${countStatus(state, "LocalChanged")}
- RemoteChanged: ${countStatus(state, "RemoteChanged")}
- Conflict: ${countStatus(state, "Conflict")}
`;
}

function countStatus(state: LlmDiffContextState, status: LocalMirrorScmResource["status"]): number {
  return state.resources.filter((resource) => resource.status === status).length;
}

function renderUnifiedPatch(input: {
  fromFile: string;
  toFile: string;
  fromText: string;
  toText: string;
}): string {
  const header = [
    `--- ${input.fromFile}`,
    `+++ ${input.toFile}`
  ];
  if (input.fromText === input.toText) {
    return `${header.join("\n")}\n`;
  }
  const fromLines = splitLines(input.fromText);
  const toLines = splitLines(input.toText);
  const ops = diffLines(fromLines, toLines);
  const hunks = buildUnifiedDiffHunks(ops, 3);
  return `${header.concat(hunks).join("\n")}\n`;
}

function splitLines(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.length === 0) {
    return [];
  }
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
}

type DiffOp =
  | { type: "equal"; line: string }
  | { type: "delete"; line: string }
  | { type: "insert"; line: string };

function diffLines(fromLines: readonly string[], toLines: readonly string[]): DiffOp[] {
  const cellCount = (fromLines.length + 1) * (toLines.length + 1);
  if (cellCount > 4_000_000) {
    return diffLinesByCommonPrefixSuffix(fromLines, toLines);
  }

  const rows: Uint32Array[] = Array.from(
    { length: fromLines.length + 1 },
    () => new Uint32Array(toLines.length + 1)
  );
  for (let fromIndex = 1; fromIndex <= fromLines.length; fromIndex += 1) {
    const row = rows[fromIndex]!;
    const previousRow = rows[fromIndex - 1]!;
    for (let toIndex = 1; toIndex <= toLines.length; toIndex += 1) {
      row[toIndex] = fromLines[fromIndex - 1] === toLines[toIndex - 1]
        ? previousRow[toIndex - 1]! + 1
        : Math.max(previousRow[toIndex]!, row[toIndex - 1]!);
    }
  }

  const reversed: DiffOp[] = [];
  let fromIndex = fromLines.length;
  let toIndex = toLines.length;
  while (fromIndex > 0 || toIndex > 0) {
    if (
      fromIndex > 0 &&
      toIndex > 0 &&
      fromLines[fromIndex - 1] === toLines[toIndex - 1]
    ) {
      reversed.push({ type: "equal", line: fromLines[fromIndex - 1]! });
      fromIndex -= 1;
      toIndex -= 1;
    } else if (
      toIndex > 0 &&
      (fromIndex === 0 || rows[fromIndex]![toIndex - 1]! >= rows[fromIndex - 1]![toIndex]!)
    ) {
      reversed.push({ type: "insert", line: toLines[toIndex - 1]! });
      toIndex -= 1;
    } else {
      reversed.push({ type: "delete", line: fromLines[fromIndex - 1]! });
      fromIndex -= 1;
    }
  }
  return reversed.reverse();
}

function diffLinesByCommonPrefixSuffix(
  fromLines: readonly string[],
  toLines: readonly string[]
): DiffOp[] {
  let prefixLength = 0;
  while (
    prefixLength < fromLines.length &&
    prefixLength < toLines.length &&
    fromLines[prefixLength] === toLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength + prefixLength < fromLines.length &&
    suffixLength + prefixLength < toLines.length &&
    fromLines[fromLines.length - 1 - suffixLength] === toLines[toLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return [
    ...fromLines.slice(0, prefixLength).map((line): DiffOp => ({ type: "equal", line })),
    ...fromLines.slice(prefixLength, fromLines.length - suffixLength).map((line): DiffOp => ({ type: "delete", line })),
    ...toLines.slice(prefixLength, toLines.length - suffixLength).map((line): DiffOp => ({ type: "insert", line })),
    ...fromLines.slice(fromLines.length - suffixLength).map((line): DiffOp => ({ type: "equal", line }))
  ];
}

function buildUnifiedDiffHunks(ops: readonly DiffOp[], contextLineCount: number): string[] {
  const changedIndexes = ops
    .map((op, index) => op.type === "equal" ? -1 : index)
    .filter((index) => index >= 0);
  if (changedIndexes.length === 0) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let rangeStart = Math.max(0, changedIndexes[0]! - contextLineCount);
  let lastChangedIndex = changedIndexes[0]!;

  for (const changedIndex of changedIndexes.slice(1)) {
    if (changedIndex - lastChangedIndex <= contextLineCount * 2 + 1) {
      lastChangedIndex = changedIndex;
      continue;
    }
    ranges.push({
      start: rangeStart,
      end: Math.min(ops.length, lastChangedIndex + contextLineCount + 1)
    });
    rangeStart = Math.max(0, changedIndex - contextLineCount);
    lastChangedIndex = changedIndex;
  }
  ranges.push({
    start: rangeStart,
    end: Math.min(ops.length, lastChangedIndex + contextLineCount + 1)
  });

  return ranges.flatMap((range) => renderUnifiedDiffHunk(ops, range.start, range.end));
}

function renderUnifiedDiffHunk(ops: readonly DiffOp[], start: number, end: number): string[] {
  const before = ops.slice(0, start);
  const hunkOps = ops.slice(start, end);
  const oldLineBefore = countOldLines(before);
  const newLineBefore = countNewLines(before);
  const oldCount = countOldLines(hunkOps);
  const newCount = countNewLines(hunkOps);
  const oldStart = oldCount === 0 ? oldLineBefore : oldLineBefore + 1;
  const newStart = newCount === 0 ? newLineBefore : newLineBefore + 1;

  return [
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...hunkOps.map((op) => {
      if (op.type === "insert") {
        return `+${op.line}`;
      }
      if (op.type === "delete") {
        return `-${op.line}`;
      }
      return ` ${op.line}`;
    })
  ];
}

function countOldLines(ops: readonly DiffOp[]): number {
  return ops.filter((op) => op.type !== "insert").length;
}

function countNewLines(ops: readonly DiffOp[]): number {
  return ops.filter((op) => op.type !== "delete").length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
