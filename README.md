# vscode-kiwifs

[日本語](https://github.com/yyamamot/vscode-kiwifs/blob/main/README.ja.md) | English

## Overview

`kiwifs` is a VS Code extension for working with [Kiwi TCMS](https://kiwitcms.org/) test plans and test cases from VS Code.
Use the `Kiwi Plans` view in Explorer to browse plans, open and update test case bodies, edit case metadata, inspect attachments, and update test executions.

When needed, you can also use a local mirror to export test case bodies as local Markdown files.
This is useful when you want to review, compare, or update Kiwi TCMS content with local tools or an LLM.

kiwifs supports an LLM-safe editing flow. Instead of letting an LLM edit Kiwi TCMS directly, kiwifs first exports the test case body to a local mirror, limits which files the LLM may read or edit, and keeps the final apply step in VS Code Source Control.
After editing, you review the diff in Source Control View and apply the change to Kiwi only after a human confirms it.

This keeps the LLM work scope narrow, avoids unintended file reads or direct remote writes, and helps edit wiki-like test case bodies more safely.

<!--
  screenshot: kiwi-plans-overview
  file: assets/readme1.png
  capture: Explorer with Kiwi Plans expanded, one plan visible, several test cases visible, and a test case body Markdown preview/editor open on the right.
  purpose: Show the main value immediately: Kiwi TCMS plans and cases can be browsed from VS Code while the test case body is readable as Markdown.
-->
<p align="center">
  <a href="#quick-start">
    <img src="assets/readme1.png" alt="Kiwi Plans overview" width="960">
  </a>
</p>

## What You Can Do

- Browse Kiwi TCMS test plans and test cases in `Kiwi Plans`
- Open and update test case bodies in VS Code
- Inspect test case metadata, history, and attachments
- Edit test case basic information
- Create new test cases in a test plan or add existing test cases to a plan
- Remove test cases from a plan or delete test cases
- Search test cases and test runs through dedicated screens
- Create and update test runs from a test run dashboard
- Manage test executions for a single test case from a case-focused screen
- Use a local mirror to compare and apply local body changes
- Use experimental LLM Assist Kit to prepare Skills and prompts for local mirror editing and diff review

## Installation

To install from the Marketplace:

1. Open the VS Code Extensions view
2. Search for `Kiwi FS` or `vscode-kiwifs`
3. Select `yyamamot.vscode-kiwifs`
4. Press `Install`
5. Configure the Kiwi TCMS connection from the Command Palette

For local validation, you can also install a VSIX build.

```sh
pnpm run package:vsix
pnpm run install:vsix
```

## Quick Start

### 1. Configure the connection

Run these commands from the Command Palette:

- `Kiwi: Set Base URL`
- `Kiwi: Set Username`
- `Kiwi: Set Password`

| Item | Details |
| --- | --- |
| Base URL | Kiwi TCMS URL such as `https://kiwi.example.com/` |
| Username | Kiwi TCMS login username |
| Password | Kiwi TCMS login password |
| Storage | Base URL is stored in settings; username and password are stored in Secret Storage |

### 2. Open `Kiwi Plans`

Run `Kiwi: Open Root` to show `Kiwi Plans` in Explorer.
Expand a test plan to inspect its test cases.

<!--
  screenshot: kiwi-plan-context
  file: assets/readme2.png
  capture: Kiwi Plans context menu or action surface for a plan/case, with primary actions such as browser open, edit basic information, test execution management, and local mirror actions visible.
  purpose: Show the reduced right-click/action surface and the main entry points for everyday work.
-->
<p align="center">
  <a href="#main-workflows">
    <img src="assets/readme2.png" alt="Kiwi Plans context actions" width="360">
  </a>
</p>

### 3. Edit a test case body

1. Expand a test plan and select a test case
2. Open the test case body as a `kiwi:` document
3. Edit the Markdown body in VS Code and save it
4. Use `Show Test Case Diff` before saving when you want to review the body change
5. Use `Refresh Test Case` when you want to reload the latest body from Kiwi

### 4. Use the test case actions screen

Open `Open Test Case Actions` from the test case context menu when you want case-focused operations in one place.
The actions screen shows the target case information at the top and provides links to common operations:

- Show test case information
- Edit basic information
- Manage test case executions
- Show test case history
- Show history diff
- Open test case in browser
- Open attachments in the editor or browser
- Add attachments

### 5. Work with test runs

Open `Kiwi: Show Test Runs` when you want to manage multiple test runs.
You can create new test runs, switch between existing runs, add test cases, and update execution results.

Use `Manage Test Case Executions` when you want to update executions for a single case.
The case-focused flow lists related test runs and supports adding the case to an existing run, creating a new run, and updating results or comments.

<!--
  screenshot: kiwi-test-run-dashboard1
  file: assets/readme3.png
  capture: Test Run dashboard with a selected plan/build/run and a visible table of test cases/execution rows. If possible, include result controls or comments in the same shot.
  purpose: Show that test execution management can be done inside VS Code, including both dashboard-style and case-focused execution workflows.
-->
<p align="center">
  <a href="#features">
    <img src="assets/readme3.png" alt="Test run dashboard" width="960">
  </a>
</p>

### 6. Use the local mirror when needed

Use the local mirror when you want to handle test case bodies as local files.
After compare, local mirror changes appear in VS Code Source Control View as `Local Changes`, `Remote Changes`, or `Conflicts`.
Use Source Control View to review diffs, apply local changes to Kiwi, or take remote changes back into the local mirror.

1. Run `Sync This Test Case Locally` or `Sync Child Test Cases Locally`
2. Run `Check This Test Case Diff` or `Check Child Test Case Diffs`
3. Review the Source Control View diff and run `Apply to Kiwi` when it is correct

The local mirror is created under `.kiwi-mirror/...` and can be edited with local tools.
kiwifs also watches local mirror file changes and reflects local-only changes into Source Control View without requiring a full compare every time.

<!--
  screenshot: kiwi-local-mirror
  file: assets/readme4.png
  capture: VS Code Source Control View showing the local mirror provider with Local Changes / Remote Changes / Conflicts, plus a diff editor if possible.
  purpose: Show that local mirror compare and apply are managed through Source Control View.
-->
<p align="center">
  <a href="#local-mirror">
    <img src="assets/readme4.png" alt="Local mirror workflow" width="960">
  </a>
</p>

### 7. Use LLM Assist Kit (Experimental)

LLM Assist Kit is an experimental feature. It prepares Skills and prompts so an LLM can work with local mirror files, but the workflow and generated artifacts may change in future releases.
Use it when you are comfortable reviewing the generated prompts and Source Control diffs yourself.

LLMs cannot directly read VS Code Source Control View or extension runtime state.
kiwifs writes the allowed read files, allowed edit files, and SCM diff evidence to `.kiwi-agent/...` as plain files.
By giving the LLM only these files, you can keep unrelated workspace files out of scope and leave the final Kiwi apply decision to the human in Source Control View.

The main goals are:

- Limit LLM reads and edits to `.kiwi-mirror/**/*.md`
- Export Source Control View diffs as patches and prompts the LLM can read
- Prevent the LLM from running `Apply to Kiwi` or `Take Remote Changes`

1. Run `Kiwi: Install LLM Local Mirror Skills` from the Command Palette
2. Sync the target test cases to the local mirror
3. Run `Kiwi: Prepare LLM Local Mirror Prompt` from Source Control View or the Command Palette
4. Ask the LLM to read `.kiwi-agent/prompt/current/prompt.md`
5. Review the resulting diff in Source Control View and apply it to Kiwi when it is correct

To ask an LLM to summarize or review SCM diffs, create the Source Control View snapshot first, then run `Kiwi: Prepare LLM Local Mirror Diff`.
The generated `.kiwi-agent/diff/current/prompt.md` is the input for reading SCM diff evidence.

In Codex, you may use `$kiwi-local-mirror-prompt` or `$kiwi-local-mirror-diff` when useful.
For Claude Code or other LLMs with different Skill syntax, do not rely on `$...`; explicitly provide these files instead.

| Purpose | Files to provide to the LLM |
| --- | --- |
| Local mirror editing | `.agents/skills/kiwi-local-mirror-prompt/SKILL.md`, `.agents/skills/kiwi-local-mirror-prompt/agents/generic.md`, `.kiwi-agent/prompt/current/prompt.md` |
| SCM diff review | `.agents/skills/kiwi-local-mirror-diff/SKILL.md`, `.agents/skills/kiwi-local-mirror-diff/agents/generic.md`, `.kiwi-agent/diff/current/prompt.md` |

| Generated path | Purpose |
| --- | --- |
| `.agents/skills/kiwi-local-mirror-prompt/` | Skill for editing local mirror Markdown |
| `.agents/skills/kiwi-local-mirror-diff/` | Skill for reading SCM diff evidence |
| `.kiwi-agent/prompt/current/` | Prompt and editable file list for an editing request |
| `.kiwi-agent/diff/current/` | Prompt and patches for SCM diff review |

<!--
  optional screenshot: kiwi-llm-assist-kit
  suggested file if added later: assets/readme5.png
  capture: Source Control View toolbar or Command Palette showing "Prepare LLM Local Mirror Prompt" / "Prepare LLM Local Mirror Diff", plus generated .kiwi-agent files in Explorer if useful.
  purpose: Only add this screenshot if the experimental LLM Assist Kit needs visual explanation; keep it secondary because the feature is experimental.
-->

LLM Assist Kit does not call Kiwi APIs or run `Apply to Kiwi`.
The final review and apply operation stays in Source Control View.

## Features

| Feature | What it does | Notes |
| --- | --- | --- |
| Test plan tree | Shows plans and test cases in `Kiwi Plans` | Available from Explorer |
| Test case body editing | Opens and saves test case bodies in VS Code | Uses normal editor workflow |
| Test case metadata view | Shows summary, status, priority, tags, and more | Separate from body editing |
| Test case metadata editing | Updates summary, status, priority, and tags | Edit only the needed fields |
| Test case creation and duplication | Creates new cases and duplicates existing cases | Creation can use Kiwi templates |
| Plan membership management | Adds existing cases, removes cases from plans, and deletes cases | Uses QuickPick and confirmation dialogs |
| Test case search | Filters by keyword, plan, status, priority, tags, and body text | Results load in pages of 50 |
| Test run search | Filters test runs by keyword, plan, and build name | Open results in the test run dashboard |
| History and diff | Shows body diff, history list, and history diff | Useful before updating |
| Freshness checks | Shows when the opened case is not the latest | Helps notice Web-side updates |
| Attachments | Lists, adds, and opens attachments | Supports browser and editor views |
| Single-case execution update | Updates execution results for one case | Useful for focused updates |
| Case execution management | Manages test runs for one case | Add to existing runs, create runs, and update results |
| Test run dashboard | Creates runs, switches runs, adds cases, and updates multiple rows | Test execution management inside VS Code |
| Local mirror | Exports bodies to local files and shows compare results in Source Control View | Designed for local tool integration |
| LLM Assist Kit | Generates Skills and prompts to scope LLM work | Experimental; for local mirror editing and SCM diff review |
| Browser integration | Opens plan and case pages in Kiwi TCMS Web UI | Useful for detailed management |

## Main Workflows

Commands prefixed with `Kiwi:` are mainly Command Palette commands.
Commands without that prefix are usually shown from `Kiwi Plans` context menus or in dedicated screens.

### Main Command Palette commands

#### Connection and basic operations

| Purpose | Command |
| --- | --- |
| Open Kiwi Plans | `Kiwi: Open Root` |
| Set Base URL | `Kiwi: Set Base URL` |
| Set Username | `Kiwi: Set Username` |
| Set Password | `Kiwi: Set Password` |
| Clear settings | `Kiwi: Clear Base URL`, `Kiwi: Clear Username`, `Kiwi: Clear Password`, `Kiwi: Clear Settings` |

#### Search test cases and test runs

| Purpose | Command |
| --- | --- |
| Lightweight case search | `Kiwi: Search Test Cases` |
| Advanced case search | `Kiwi: Find Test Cases` |
| Show test runs | `Kiwi: Show Test Runs` |
| Find test runs | `Kiwi: Find Test Runs` |

### Main context and screen commands

#### Test plan actions

| Purpose | Command |
| --- | --- |
| Show information | `Show Test Plan Information` |
| Open in browser | `Show in Browser` |
| Create new test case | `Create Here` |
| Add existing case | `Add Existing Test Case` |
| Remove case | `Remove Test Case from Test Plan` |

#### Test case and execution actions

| Purpose | Command |
| --- | --- |
| Show information | `Show Test Case Information` |
| Edit metadata | `Edit Basic Information` |
| Refresh body | `Refresh Test Case` |
| Check latest state | `Check Latest Test Case State` |
| Show diff | `Show Test Case Diff` |
| Show history | `Show Test Case History` |
| Show history diff | `Show Test Case History Diff` |
| Duplicate | `Duplicate Test Case` |
| Update execution result | `Update Test Case Execution Result` |
| Manage executions | `Manage Test Case Executions` |

#### Local mirror

| Purpose | Command |
| --- | --- |
| Sync one test case | `Sync This Test Case Locally` |
| Sync child test cases | `Sync Child Test Cases Locally` |
| Compare a test case | `Check This Test Case Diff` |
| Compare child test cases | `Check Child Test Case Diffs` |
| Apply from Source Control View | `Apply to Kiwi` |
| Take remote changes from Source Control View | `Take Remote Changes` |
| Open | `Open Local Mirror` |

#### LLM Assist Kit

| Purpose | Command |
| --- | --- |
| Install Skills | `Kiwi: Install LLM Local Mirror Skills` |
| Prepare edit prompt | `Kiwi: Prepare LLM Local Mirror Prompt` |
| Prepare SCM diff prompt | `Kiwi: Prepare LLM Local Mirror Diff` |

## Limitations

| Limitation | Details |
| --- | --- |
| VS Code extension only | This is not an operating system filesystem replacement |
| Metadata editing is scoped | Summary, status, priority, and tags are supported |
| Local mirror is optional | Basic browsing and editing do not require it |
| Runtime logs are for development | Runtime logs are enabled only during F5 debug sessions |
| LLM Assist Kit does not apply changes | Kiwi apply remains a human Source Control View action |

## Requirements / Compatibility

| Item | Requirement |
| --- | --- |
| VS Code | Desktop `1.105+` |
| Kiwi TCMS | Environment with XML-RPC access |
| Verified Kiwi TCMS | `15.3` |
| Authentication | Base URL + username + password |
| Local workspace | File workspace recommended when using local mirror |
| Marketplace package | Includes `README.md`, `README.ja.md`, `CHANGELOG.md`, `CHANGELOG.ja.md`, and screenshot assets |

## Build from Source

Requirements:

- Node.js `22+`
- pnpm `10.30.3+`
- VS Code Desktop `1.105+`

Install dependencies and build the extension:

```sh
pnpm install
pnpm run build
```

Package a local VSIX:

```sh
pnpm run package:vsix
```

Install the generated VSIX into VS Code:

```sh
pnpm run install:vsix
```

Run the main verification gate:

```sh
pnpm run verify
```

For UI changes:

```sh
pnpm run verify:ui-change -- --scenario smoke --id <feature-id>
```

## License

- License: [MIT](./LICENSE)
