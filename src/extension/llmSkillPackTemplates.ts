export const KIWI_LOCAL_MIRROR_PROMPT_SKILL = "kiwi-local-mirror-prompt";
export const KIWI_LOCAL_MIRROR_PROMPT_SKILL_DIR = ".agents/skills/kiwi-local-mirror-prompt";
export const KIWI_LOCAL_MIRROR_DIFF_SKILL = "kiwi-local-mirror-diff";
export const KIWI_LOCAL_MIRROR_DIFF_SKILL_DIR = ".agents/skills/kiwi-local-mirror-diff";

export interface LlmPromptUiLabels {
  kiwiApply: string;
  takeRemote: string;
}

const DEFAULT_PROMPT_UI_LABELS: LlmPromptUiLabels = {
  kiwiApply: "Apply to Kiwi",
  takeRemote: "Take Remote Changes"
};

export const KIWI_SKILL_PACK_FILES: ReadonlyArray<{ relativePath: string; content: string }> = [
  {
    relativePath: `${KIWI_LOCAL_MIRROR_PROMPT_SKILL_DIR}/SKILL.md`,
    content: `---
name: kiwi-local-mirror-prompt
description: Use when a user asks an LLM to work with kiwifs local mirror Markdown while limiting file reads and edits to the active local mirror session scope.
---

# Kiwi Local Mirror Prompt

Use this skill to prepare and follow a minimal kiwifs local mirror work scope.

## Primary Rule

The user's LLM prompt is the source of truth for what to do. Do not add review, conflict resolution, safety checking, or Kiwi apply work unless the user explicitly asks for it.

If your LLM does not support \`$kiwi-local-mirror-prompt\` skill syntax, read this \`SKILL.md\` file directly and follow the same rules.

## Allowed Reads

- \`.kiwi-agent/prompt/current/task.md\`
- \`.kiwi-agent/prompt/current/editable-files.txt\`
- \`.kiwi-agent/prompt/current/do-not-edit.txt\`
- \`.kiwi-agent/prompt/current/prompt.md\`
- Markdown files listed in \`.kiwi-agent/prompt/current/editable-files.txt\`

Kiwifs itself reads \`.kiwi-mirror/kiwi-mirror.json\` to create \`editable-files.txt\`. You, the LLM, must not read or edit the manifest.

## Allowed Edits

- Only Markdown files listed in \`.kiwi-agent/prompt/current/editable-files.txt\`
- Do not create new files.
- Do not delete files.

## Do Not Read Or Edit

- Any workspace file outside the allowed reads above
- \`.kiwi-mirror/kiwi-mirror.json\`
- \`${KIWI_LOCAL_MIRROR_PROMPT_SKILL_DIR}/**\`
- \`.kiwi-agent/**\` (only the prompt input files listed under Allowed Reads may be read)

## Command Boundaries

- Do not call Kiwi APIs.
- Do not run SCM commands.
- Do not run upload, take-remote, or remote apply commands.
- Do not run the Kiwi Apply command.
`
  },
  {
    relativePath: `${KIWI_LOCAL_MIRROR_PROMPT_SKILL_DIR}/agents/openai.yaml`,
    content: `interface:
  display_name: "Kiwi Local Mirror Prompt"
  short_description: "Limit LLM local mirror reads and edits to the active kiwifs session scope"
  default_prompt: "Use $kiwi-local-mirror-prompt for the current kiwifs local mirror request."

policy:
  allow_implicit_invocation: false
`
  },
  {
    relativePath: `${KIWI_LOCAL_MIRROR_PROMPT_SKILL_DIR}/agents/generic.md`,
    content: `# Generic LLM Usage

Use this file for LLMs that do not support \`$kiwi-local-mirror-prompt\` skill syntax.

Provide these files explicitly:

- \`${KIWI_LOCAL_MIRROR_PROMPT_SKILL_DIR}/SKILL.md\`
- \`.kiwi-agent/prompt/current/task.md\`
- \`.kiwi-agent/prompt/current/editable-files.txt\`
- \`.kiwi-agent/prompt/current/do-not-edit.txt\`
- \`.kiwi-agent/prompt/current/prompt.md\`

Then ask the LLM to read and edit only the Markdown files listed in \`editable-files.txt\`.
`
  },
  {
    relativePath: `${KIWI_LOCAL_MIRROR_DIFF_SKILL_DIR}/SKILL.md`,
    content: `---
name: kiwi-local-mirror-diff
description: Use when reading kiwifs local mirror SCM diff context from .kiwi-agent/diff/current without editing files or running Kiwi/SCM commands.
---

# Kiwi Local Mirror Diff

Use this skill to read generated local mirror diff context. This skill is read-only.

If your LLM does not support \`$kiwi-local-mirror-diff\` skill syntax, read this \`SKILL.md\` file directly and follow the same rules.

## Allowed Reads

- \`.kiwi-agent/diff/current/scm-state.json\`
- \`.kiwi-agent/diff/current/changed-files.txt\`
- \`.kiwi-agent/diff/current/diffs/*.patch\`
- \`.kiwi-agent/diff/current/prompt.md\`

If \`.kiwi-agent/diff/current/changed-files.txt\` is empty, report that no local mirror Markdown diff context is available and ask the user to run local mirror compare or prepare the diff context again. Do not inspect workspace files to compensate.

## Review Goals

- Summarize meaningful test case body changes.
- Identify accidental removals, risky assumptions, and conflict risks.
- Treat \`RemoteChanged\` resources as Kiwi-side update warnings, not apply candidates.
- For \`Conflict\` resources, explain what needs human merge review.
- End with concise human review points.

## Do Not Read Or Edit

- Do not edit any file.
- Do not read workspace files outside the allowed diff context artifacts above.
- Do not read or edit \`.kiwi-mirror/**\`.
- Do not read or edit \`.agents/**\`.
- Do not read or edit \`.kiwi-agent/**\` (only the diff context artifacts listed under Allowed Reads may be read).

## Command Boundaries

- Do not call Kiwi APIs.
- Do not run SCM commands.
- Do not run upload, take-remote, or remote apply commands.
- Do not run the Kiwi Apply command.
- Do not run the Take Remote command.
`
  },
  {
    relativePath: `${KIWI_LOCAL_MIRROR_DIFF_SKILL_DIR}/agents/openai.yaml`,
    content: `interface:
  display_name: "Kiwi Local Mirror Diff"
  short_description: "Read kiwifs local mirror SCM diff context without editing files"
  default_prompt: "Use $kiwi-local-mirror-diff to read the current kiwifs local mirror diff context."

policy:
  allow_implicit_invocation: false
`
  },
  {
    relativePath: `${KIWI_LOCAL_MIRROR_DIFF_SKILL_DIR}/agents/generic.md`,
    content: `# Generic LLM Usage

Use this file for LLMs that do not support \`$kiwi-local-mirror-diff\` skill syntax.

Provide these files explicitly:

- \`${KIWI_LOCAL_MIRROR_DIFF_SKILL_DIR}/SKILL.md\`
- \`.kiwi-agent/diff/current/scm-state.json\`
- \`.kiwi-agent/diff/current/changed-files.txt\`
- \`.kiwi-agent/diff/current/diffs/*.patch\`
- \`.kiwi-agent/diff/current/prompt.md\`

Then ask the LLM to summarize local mirror diffs, risks, conflicts, and human review points without editing files or running commands.
`
  }
];

export const DO_NOT_EDIT_ENTRIES = [
  ".kiwi-mirror/kiwi-mirror.json",
  `${KIWI_LOCAL_MIRROR_PROMPT_SKILL_DIR}/**`,
  ".kiwi-agent/** (prompt input files may be read only; do not edit any .kiwi-agent file)"
] as const;

export function renderTaskFile(taskText?: string): string {
  const body = taskText?.trim()
    ? taskText.trim()
    : "Use the user's LLM prompt as the source of truth for this local mirror task.";
  return `# LLM Local Mirror Task

${body}
`;
}

export function renderEditableFiles(files: readonly string[]): string {
  return files.length > 0 ? `${files.join("\n")}\n` : "";
}

export function renderDoNotEditFile(): string {
  return `${DO_NOT_EDIT_ENTRIES.join("\n")}\n`;
}

export function renderPrompt(files: readonly string[]): string {
  return renderPromptWithOptions({ files });
}

export function renderPromptWithOptions(options: {
  files: readonly string[];
  gitignoreWarning?: string;
  uiLabels?: LlmPromptUiLabels;
}): string {
  const files = options.files;
  const uiLabels = options.uiLabels ?? DEFAULT_PROMPT_UI_LABELS;
  const editableBlock = files.length > 0
    ? files.map((file) => `- ${file}`).join("\n")
    : "- No editable files are listed. Ask the user to sync cases to local mirror first.";
  const gitignoreBlock = options.gitignoreWarning
    ? `\nWarning:\n\n- ${options.gitignoreWarning}\n`
    : "";

  return `$kiwi-local-mirror-prompt

If your LLM does not support $skill syntax, read ${KIWI_LOCAL_MIRROR_PROMPT_SKILL_DIR}/SKILL.md directly and follow the same rules.

You are working on a kiwifs local mirror request.

Read only these prompt inputs:

- .kiwi-agent/prompt/current/task.md
- .kiwi-agent/prompt/current/editable-files.txt
- .kiwi-agent/prompt/current/do-not-edit.txt
- ${KIWI_LOCAL_MIRROR_PROMPT_SKILL_DIR}/SKILL.md

Editable files:

${editableBlock}

Rules:

- Follow the user's LLM prompt as the source of truth for the task.
- Read only the prompt inputs above and the Markdown files listed in editable-files.txt.
- Edit only Markdown files listed in editable-files.txt.
- Do not create new files.
- Do not delete files.
- Do not read or edit .kiwi-mirror/kiwi-mirror.json.
- Do not read or edit ${KIWI_LOCAL_MIRROR_PROMPT_SKILL_DIR}/**.
- Do not edit .kiwi-agent/**; read only the prompt inputs listed above.
- Do not call Kiwi APIs, SCM commands, upload commands, take-remote commands, or remote apply commands.
- Do not run the Kiwi Apply command, including the current UI command label \`${uiLabels.kiwiApply}\`.
- Do not add review, conflict resolution, or safety checking unless the user explicitly asks for it.
${gitignoreBlock}
`;
}
