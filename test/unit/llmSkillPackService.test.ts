import * as assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  ensureLlmGitignoreEntries,
  formatGitignoreWarning,
  installLlmSkillPack,
  readCurrentLlmPrompt,
  startLlmEditSession
} from "../../src/extension/llmSkillPackService";
import { writeLocalMirrorManifest } from "../../src/extension/localMirrorService";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kiwifs-llm-skill-"));
  tempDirs.push(dir);
  return dir;
}

describe("llmSkillPackService", () => {
  it("installs kiwi local mirror prompt skill without touching AGENTS.md", async () => {
    const workspaceRoot = await createWorkspace();
    const agentsPath = path.join(workspaceRoot, "AGENTS.md");
    await writeFile(agentsPath, "# Existing Instructions\n", "utf8");

    const result = await installLlmSkillPack(workspaceRoot);

    assert.deepEqual(result.files, [
      ".agents/skills/kiwi-local-mirror-prompt/SKILL.md",
      ".agents/skills/kiwi-local-mirror-prompt/agents/openai.yaml",
      ".agents/skills/kiwi-local-mirror-prompt/agents/generic.md",
      ".agents/skills/kiwi-local-mirror-diff/SKILL.md",
      ".agents/skills/kiwi-local-mirror-diff/agents/openai.yaml",
      ".agents/skills/kiwi-local-mirror-diff/agents/generic.md"
    ]);
    assert.equal(await readFile(agentsPath, "utf8"), "# Existing Instructions\n");
    const skill = await readFile(path.join(workspaceRoot, ".agents", "skills", "kiwi-local-mirror-prompt", "SKILL.md"), "utf8");
    assert.match(skill, /^---\nname: kiwi-local-mirror-prompt\n/m);
    assert.match(skill, /^description: Use when a user asks an LLM to work with kiwifs local mirror Markdown/m);
    assert.match(skill, /`\.kiwi-agent\/prompt\/current\/editable-files\.txt`/);
    assert.match(skill, /The user's LLM prompt is the source of truth/);
    assert.match(skill, /If your LLM does not support `\$kiwi-local-mirror-prompt` skill syntax/);
    assert.match(skill, /You, the LLM, must not read or edit the manifest/);
    assert.match(skill, /\.kiwi-agent\/\*\*` \(only the prompt input files listed under Allowed Reads may be read\)/);
    assert.doesNotMatch(skill, /except the prompt input files/);
    assert.match(skill, /Only Markdown files listed/);
    assert.match(skill, /Do not create new files/);
    assert.match(skill, /Do not delete files/);
    assert.match(skill, /Do not run the Kiwi Apply command\./);
    assert.match(skill, /Do Not Read Or Edit/);
    assert.doesNotMatch(skill, /Review Before Apply/);
    assert.doesNotMatch(skill, /Conflict Resolution/);
    assert.doesNotMatch(skill, /safety-report/);
    assert.doesNotMatch(skill, /checkLlmLocalMirrorSafety/);
    const openaiYaml = await readFile(
      path.join(workspaceRoot, ".agents", "skills", "kiwi-local-mirror-prompt", "agents", "openai.yaml"),
      "utf8"
    );
    assert.match(openaiYaml, /display_name: "Kiwi Local Mirror Prompt"/);
    assert.match(openaiYaml, /default_prompt: "Use \$kiwi-local-mirror-prompt/);
    assert.match(openaiYaml, /allow_implicit_invocation: false/);
    const generic = await readFile(
      path.join(workspaceRoot, ".agents", "skills", "kiwi-local-mirror-prompt", "agents", "generic.md"),
      "utf8"
    );
    assert.match(generic, /LLMs that do not support `\$kiwi-local-mirror-prompt` skill syntax/);
    assert.match(generic, /\.kiwi-agent\/prompt\/current\/editable-files\.txt/);
    const diffSkill = await readFile(
      path.join(workspaceRoot, ".agents", "skills", "kiwi-local-mirror-diff", "SKILL.md"),
      "utf8"
    );
    assert.match(diffSkill, /^---\nname: kiwi-local-mirror-diff\n/m);
    assert.match(diffSkill, /\.kiwi-agent\/diff\/current\/scm-state\.json/);
    assert.match(diffSkill, /\.kiwi-agent\/diff\/current\/diffs\/\*\.patch/);
    assert.match(diffSkill, /If `\.kiwi-agent\/diff\/current\/changed-files\.txt` is empty/);
    assert.match(diffSkill, /Do not inspect workspace files to compensate/);
    assert.match(diffSkill, /\.kiwi-agent\/\*\*` \(only the diff context artifacts listed under Allowed Reads may be read\)/);
    assert.doesNotMatch(diffSkill, /except the review artifacts/);
    assert.match(diffSkill, /Do not edit any file/);
    assert.match(diffSkill, /Do not run the Kiwi Apply command\./);
    assert.match(diffSkill, /Do not run the Take Remote command\./);
    const diffOpenaiYaml = await readFile(
      path.join(workspaceRoot, ".agents", "skills", "kiwi-local-mirror-diff", "agents", "openai.yaml"),
      "utf8"
    );
    assert.match(diffOpenaiYaml, /default_prompt: "Use \$kiwi-local-mirror-diff/);
    assert.match(diffOpenaiYaml, /allow_implicit_invocation: false/);
    const diffGeneric = await readFile(
      path.join(workspaceRoot, ".agents", "skills", "kiwi-local-mirror-diff", "agents", "generic.md"),
      "utf8"
    );
    assert.match(diffGeneric, /LLMs that do not support `\$kiwi-local-mirror-diff` skill syntax/);
    assert.match(diffGeneric, /\.kiwi-agent\/diff\/current\/diffs\/\*\.patch/);
    await assert.rejects(
      readFile(path.join(workspaceRoot, ".agents", "kiwi", "SKILL.md"), "utf8"),
      /ENOENT/
    );
    await assert.rejects(
      readFile(path.join(workspaceRoot, ".agents", "skills", "kiwi-local-mirror-editing", "SKILL.md"), "utf8"),
      /ENOENT/
    );
    await assert.rejects(
      readFile(path.join(workspaceRoot, ".agents", "skills", "kiwi-local-mirror-prompt", "safety.md"), "utf8"),
      /ENOENT/
    );
  });

  it("creates a current prompt from local mirror manifest editable Markdown files only", async () => {
    const workspaceRoot = await createWorkspace();
    await writeLocalMirrorManifest(path.join(workspaceRoot, ".kiwi-mirror", "kiwi-mirror.json"), {
      version: 1,
      cases: {
        "501": {
          caseId: 501,
          planId: 100,
          localPath: path.join(".kiwi-mirror", "plans", "100 - Regression", "cases", "501 - Login works.md"),
          downloadedVersionToken: "history_id:10",
          downloadedContentHash: "hash",
          lastDownloadedAt: "2026-05-03T00:00:00.000Z"
        },
        "502": {
          caseId: 502,
          planId: 100,
          localPath: path.join(".kiwi-mirror", "plans", "100 - Regression", "cases", "502 - Password reset.md"),
          downloadedVersionToken: "history_id:11",
          downloadedContentHash: "hash",
          lastDownloadedAt: "2026-05-03T00:00:00.000Z"
        },
        "999": {
          caseId: 999,
          planId: 100,
          localPath: ".kiwi-agent/prompt/current/prompt.md",
          downloadedVersionToken: "history_id:12",
          downloadedContentHash: "hash",
          lastDownloadedAt: "2026-05-03T00:00:00.000Z"
        }
      }
    });
    const existingEditablePath = path.join(
      workspaceRoot,
      ".kiwi-mirror",
      "plans",
      "100 - Regression",
      "cases",
      "501 - Login works.md"
    );
    await mkdir(path.dirname(existingEditablePath), { recursive: true });
    await writeFile(existingEditablePath, "Existing case body\n", "utf8");

    const result = await startLlmEditSession(workspaceRoot, { taskText: "Improve Plan 100 local mirror cases." });

    assert.deepEqual(result.editableFiles, [
      ".kiwi-mirror/plans/100 - Regression/cases/501 - Login works.md"
    ]);
    assert.deepEqual(result.files, [
      path.join(".kiwi-agent", "prompt", "current", "task.md"),
      path.join(".kiwi-agent", "prompt", "current", "editable-files.txt"),
      path.join(".kiwi-agent", "prompt", "current", "do-not-edit.txt"),
      path.join(".kiwi-agent", "prompt", "current", "prompt.md")
    ]);
    assert.match(
      await readFile(path.join(workspaceRoot, ".kiwi-agent", "prompt", "current", "task.md"), "utf8"),
      /Improve Plan 100 local mirror cases/
    );
    const editable = await readFile(
      path.join(workspaceRoot, ".kiwi-agent", "prompt", "current", "editable-files.txt"),
      "utf8"
    );
    assert.match(editable, /\.kiwi-mirror\/plans\/100 - Regression\/cases\/501 - Login works\.md/);
    assert.doesNotMatch(editable, /\.kiwi-mirror\/plans\/100 - Regression\/cases\/502 - Password reset\.md/);
    assert.doesNotMatch(editable, /\.kiwi-agent\/sessions\/current\/prompt\.md/);
    const doNotEdit = await readFile(
      path.join(workspaceRoot, ".kiwi-agent", "prompt", "current", "do-not-edit.txt"),
      "utf8"
    );
    assert.match(doNotEdit, /\.kiwi-mirror\/kiwi-mirror\.json/);
    assert.match(doNotEdit, /\.agents\/skills\/kiwi-local-mirror-prompt\/\*\*/);
    assert.match(doNotEdit, /\.kiwi-agent\/\*\* \(prompt input files may be read only; do not edit any \.kiwi-agent file\)/);
    const prompt = await readCurrentLlmPrompt(workspaceRoot);
    assert.match(prompt, /\$kiwi-local-mirror-prompt/);
    assert.match(prompt, /If your LLM does not support \$skill syntax/);
    assert.match(prompt, /Read only the prompt inputs above and the Markdown files listed in editable-files.txt/);
    assert.match(prompt, /Do not create new files/);
    assert.match(prompt, /Do not delete files/);
    assert.match(prompt, /Do not edit \.kiwi-agent\/\*\*; read only the prompt inputs listed above/);
    assert.match(prompt, /Do not run the Kiwi Apply command, including the current UI command label `Apply to Kiwi`/);
    assert.match(prompt, /Do not add review, conflict resolution, or safety checking unless the user explicitly asks/);
    assert.doesNotMatch(prompt, /LLM ローカルミラー安全確認/);
    assert.doesNotMatch(prompt, /safety-report/);
  });

  it("creates an empty prompt when local mirror manifest is missing", async () => {
    const workspaceRoot = await createWorkspace();

    const result = await startLlmEditSession(workspaceRoot);

    assert.deepEqual(result.editableFiles, []);
    const prompt = await readCurrentLlmPrompt(workspaceRoot);
    assert.match(prompt, /\.agents\/skills\/kiwi-local-mirror-prompt\/SKILL\.md/);
    assert.match(prompt, /No editable files are listed/);
    assert.match(prompt, /sync cases to local mirror first/);
  });

  it("updates gitignore with only local mirror and agent artifact entries", async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(path.join(workspaceRoot, ".gitignore"), "dist/\n.kiwi-mirror/\n", "utf8");

    const result = await ensureLlmGitignoreEntries(workspaceRoot, true);

    assert.deepEqual(result, {
      missingEntries: [".kiwi-agent/"],
      updated: true,
      path: ".gitignore"
    });
    const gitignore = await readFile(path.join(workspaceRoot, ".gitignore"), "utf8");
    assert.match(gitignore, /^\.kiwi-mirror\/$/m);
    assert.match(gitignore, /^\.kiwi-agent\/$/m);
    assert.doesNotMatch(gitignore, /^\.agents\/kiwi\/$/m);
    assert.doesNotMatch(gitignore, /^\.agents\/skills\/kiwi-local-mirror-prompt\/$/m);

    const second = await ensureLlmGitignoreEntries(workspaceRoot, true);
    assert.deepEqual(second, {
      missingEntries: [],
      updated: false,
      path: ".gitignore"
    });
    assert.equal(await readFile(path.join(workspaceRoot, ".gitignore"), "utf8"), gitignore);
  });

  it("keeps generating prompt artifacts with warning when gitignore update is skipped", async () => {
    const workspaceRoot = await createWorkspace();

    const gitignoreResult = await ensureLlmGitignoreEntries(workspaceRoot, false);
    const warning = formatGitignoreWarning(gitignoreResult);
    const session = await startLlmEditSession(workspaceRoot, { gitignoreWarning: warning });

    assert.deepEqual(gitignoreResult.missingEntries, [".kiwi-mirror/", ".kiwi-agent/"]);
    assert.equal(gitignoreResult.updated, false);
    assert.equal(session.files.length, 4);
    await assert.rejects(readFile(path.join(workspaceRoot, ".gitignore"), "utf8"), /ENOENT/);
    assert.match(warning ?? "", /\.gitignore does not include \.kiwi-mirror\/, \.kiwi-agent\//);
    const prompt = await readFile(
      path.join(workspaceRoot, ".kiwi-agent", "prompt", "current", "prompt.md"),
      "utf8"
    );
    assert.match(prompt, /\.gitignore does not include \.kiwi-mirror\/, \.kiwi-agent\//);
    await assert.rejects(
      readFile(path.join(workspaceRoot, ".kiwi-agent", "prompt", "current", "review-checklist.md"), "utf8"),
      /ENOENT/
    );
  });

  it("does not generate legacy editing review conflict or safety reference files", async () => {
    const workspaceRoot = await createWorkspace();
    await installLlmSkillPack(workspaceRoot);

    for (const fileName of ["editing.md", "review.md", "conflict-resolution.md", "safety.md"]) {
      await assert.rejects(
        readFile(path.join(workspaceRoot, ".agents", "skills", "kiwi-local-mirror-prompt", fileName), "utf8"),
        /ENOENT/
      );
    }
  });
});
