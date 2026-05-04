import * as assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  createLlmLocalMirrorDiffContext,
  readCurrentLlmLocalMirrorDiffPrompt
} from "../../src/extension/llmDiffContextService";
import { LocalMirrorScmResource, LocalMirrorScmState } from "../../src/extension/localMirrorSourceControl";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kiwifs-llm-diff-"));
  tempDirs.push(dir);
  return dir;
}

function resource(input: {
  workspaceRoot: string;
  caseId: number;
  status: LocalMirrorScmResource["status"];
  fileName?: string;
}): LocalMirrorScmResource {
  const fileName = input.fileName ?? `${input.caseId} - Login works.md`;
  const localPath = path.join(input.workspaceRoot, ".kiwi-mirror", "plans", "100 - Regression", "cases", fileName);
  return {
    plan: { id: 100, name: "Regression" },
    caseRef: { id: input.caseId, summary: fileName.replace(/^\d+\s*-\s*/, "").replace(/\.md$/, "") },
    status: input.status,
    localPath,
    localUri: { scheme: "file", path: localPath, fsPath: localPath },
    remoteUri: { scheme: "kiwi-diff", path: `/mirror-remote/${input.caseId}` },
    diffTitle: `${input.caseId} (Local Mirror ↔ Remote)`
  };
}

function state(resources: LocalMirrorScmResource[]): LocalMirrorScmState {
  return {
    target: {
      kind: "plan",
      plan: { id: 100, name: "Regression" }
    },
    resources
  };
}

describe("llmDiffContextService", () => {
  it("fails when SCM state is missing", async () => {
    const workspaceRoot = await createWorkspace();

    await assert.rejects(
      createLlmLocalMirrorDiffContext(workspaceRoot, undefined),
      /No local mirror SCM snapshot/
    );
  });

  it("creates diff context artifacts from local mirror SCM resources", async () => {
    const workspaceRoot = await createWorkspace();
    const resources = [
      resource({ workspaceRoot, caseId: 501, status: "LocalChanged" }),
      resource({ workspaceRoot, caseId: 502, status: "RemoteChanged", fileName: "502 - Password reset.md" }),
      resource({ workspaceRoot, caseId: 503, status: "Conflict", fileName: "503 - Conflict case.md" })
    ];

    const result = await createLlmLocalMirrorDiffContext(workspaceRoot, state(resources), {
      now: new Date("2026-05-03T00:00:00.000Z"),
      readResourceText: async (scmResource, side) =>
        side === "remote"
          ? `# Remote ${scmResource.caseRef.id}\n`
          : `# Local ${scmResource.caseRef.id}\n`
    });

    assert.equal(result.resourceCount, 3);
    assert.equal(result.promptPath, path.join(".kiwi-agent", "diff", "current", "prompt.md"));
    assert.ok(result.files.includes(path.join(".kiwi-agent", "diff", "current", "diffs", "100-501.patch")));
    const scmState = JSON.parse(
      await readFile(path.join(workspaceRoot, ".kiwi-agent", "diff", "current", "scm-state.json"), "utf8")
    ) as {
      resources: Array<{
        status: string;
        changedFile?: string;
        patchPath?: string;
        patchStatus?: string;
        applyCandidate: boolean;
      }>;
    };
    assert.deepEqual(scmState.resources.map((entry) => entry.status), [
      "LocalChanged",
      "RemoteChanged",
      "Conflict"
    ]);
    assert.deepEqual(scmState.resources.map((entry) => entry.applyCandidate), [true, false, true]);
    assert.deepEqual(scmState.resources.map((entry) => entry.patchStatus), ["changed", "changed", "changed"]);
    assert.match(scmState.resources[0]?.changedFile ?? "", /^\.kiwi-mirror\/plans\/100 - Regression\/cases\/501/);
    assert.match(scmState.resources[0]?.patchPath ?? "", /100-501\.patch$/);

    const changedFiles = await readFile(
      path.join(workspaceRoot, ".kiwi-agent", "diff", "current", "changed-files.txt"),
      "utf8"
    );
    assert.match(changedFiles, /\.kiwi-mirror\/plans\/100 - Regression\/cases\/501 - Login works\.md/);
    assert.match(changedFiles, /\.kiwi-mirror\/plans\/100 - Regression\/cases\/502 - Password reset\.md/);

    const patch = await readFile(
      path.join(workspaceRoot, ".kiwi-agent", "diff", "current", "diffs", "100-501.patch"),
      "utf8"
    );
    assert.match(patch, /^--- remote\/501\.md/m);
    assert.match(patch, /^\+\+\+ \.kiwi-mirror\/plans\/100 - Regression\/cases\/501 - Login works\.md/m);
    assert.match(patch, /^@@ -1,1 \+1,1 @@$/m);
    assert.match(patch, /^-# Remote 501$/m);
    assert.match(patch, /^\+# Local 501$/m);
  });

  it("writes real unified diff hunks with context instead of full file replacement", async () => {
    const workspaceRoot = await createWorkspace();
    const resources = [resource({ workspaceRoot, caseId: 501, status: "LocalChanged" })];
    const remoteText = [
      "# Purpose",
      "",
      "Line 1",
      "Line 2",
      "Line 3",
      "Line 4",
      "Line 5",
      "Line 6",
      "Line 7"
    ].join("\n");
    const localText = [
      "# Purpose",
      "",
      "Line 1",
      "Line 2 updated",
      "Line 3",
      "Line 4",
      "Line 5",
      "Line 6",
      "Line 7"
    ].join("\n");

    await createLlmLocalMirrorDiffContext(workspaceRoot, state(resources), {
      readResourceText: async (_resource, side) => side === "remote" ? remoteText : localText
    });

    const patch = await readFile(
      path.join(workspaceRoot, ".kiwi-agent", "diff", "current", "diffs", "100-501.patch"),
      "utf8"
    );
    assert.match(patch, /^@@ -1,7 \+1,7 @@$/m);
    assert.match(patch, /^ # Purpose$/m);
    assert.match(patch, /^ Line 1$/m);
    assert.match(patch, /^-Line 2$/m);
    assert.match(patch, /^\+Line 2 updated$/m);
    assert.match(patch, /^ Line 5$/m);
    assert.doesNotMatch(patch, /^-Line 6$/m);
    assert.doesNotMatch(patch, /^\+Line 6$/m);
  });

  it("marks unchanged patch artifacts in scm-state without treating them as generation failures", async () => {
    const workspaceRoot = await createWorkspace();
    const resources = [resource({ workspaceRoot, caseId: 501, status: "LocalChanged" })];

    await createLlmLocalMirrorDiffContext(workspaceRoot, state(resources), {
      readResourceText: async () => "# Same\n"
    });

    const scmState = JSON.parse(
      await readFile(path.join(workspaceRoot, ".kiwi-agent", "diff", "current", "scm-state.json"), "utf8")
    ) as {
      resources: Array<{ patchStatus?: string; warning?: string }>;
      warnings: string[];
    };
    const patch = await readFile(
      path.join(workspaceRoot, ".kiwi-agent", "diff", "current", "diffs", "100-501.patch"),
      "utf8"
    );
    assert.equal(scmState.resources[0]?.patchStatus, "unchanged");
    assert.equal(scmState.resources[0]?.warning, undefined);
    assert.deepEqual(scmState.warnings, []);
    assert.equal(patch, "--- remote/501.md\n+++ .kiwi-mirror/plans/100 - Regression/cases/501 - Login works.md\n");
  });

  it("keeps the context when a resource patch cannot be generated", async () => {
    const workspaceRoot = await createWorkspace();
    const resources = [resource({ workspaceRoot, caseId: 501, status: "LocalChanged" })];

    const result = await createLlmLocalMirrorDiffContext(workspaceRoot, state(resources), {
      readResourceText: async () => {
        throw new Error("missing content");
      }
    });

    assert.equal(result.resourceCount, 1);
    assert.match(result.warnings[0] ?? "", /missing content/);
    const scmState = await readFile(
      path.join(workspaceRoot, ".kiwi-agent", "diff", "current", "scm-state.json"),
      "utf8"
    );
    assert.match(scmState, /Failed to generate patch for case 501/);
  });

  it("writes prompt with read-only diff rules", async () => {
    const workspaceRoot = await createWorkspace();
    await createLlmLocalMirrorDiffContext(
      workspaceRoot,
      state([resource({ workspaceRoot, caseId: 501, status: "Conflict" })]),
      {
        readResourceText: async (_resource, side) => side
      }
    );

    const prompt = await readCurrentLlmLocalMirrorDiffPrompt(workspaceRoot);
    assert.match(prompt, /^\$kiwi-local-mirror-diff/);
    assert.match(prompt, /\.agents\/skills\/kiwi-local-mirror-diff\/SKILL\.md/);
    assert.match(prompt, /\.agents\/skills\/kiwi-local-mirror-diff\/agents\/generic\.md/);
    assert.match(prompt, /Do not call Kiwi APIs, SCM commands/);
    assert.match(prompt, /Do not run the Kiwi Apply command or Take Remote command/);
    assert.match(prompt, /current UI command labels `Apply to Kiwi` and `Take Remote Changes`/);
    assert.match(prompt, /patchStatus=unchanged/);
    assert.match(prompt, /Do not perform secret scanning/);
    assert.match(prompt, /Conflict: 1/);

    await assert.rejects(
      readFile(path.join(workspaceRoot, ".kiwi-agent", "diff", "current", "review-checklist.md"), "utf8"),
      /ENOENT/
    );
  });
});
