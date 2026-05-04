# Changelog

[日本語](https://github.com/yyamamot/vscode-kiwifs/blob/main/CHANGELOG.ja.md) | English

## 0.0.5 (2026-05-04)

- Fixed cases where normally installed extensions could be detected as unexpectedly modified.
- Removed passwords from internal temporary credential keys.
- Standardized execution wording in the Test Case Actions Webview as test execution.
- Added direct access to manage test case executions from the test case context menu.
- Added Source Control View actions to prepare LLM Local Mirror Prompt and Diff inputs.
- Clarified the allowed read and edit scope for LLM Local Mirror Prompt.
- Added guidance for LLM Local Mirror Prompt to avoid creating or deleting files.
- Made LLM Local Mirror Diff Context distinguish unchanged resources from diff generation failures.
- Changed LLM Local Mirror Diff Context patches to include surrounding context.
- Added `.gitignore` confirmation for `.kiwi-mirror/` and `.kiwi-agent/` when using LLM Assist Kit.
- Expanded Japanese / English UI localization for command names, Webviews, Source Control View, and LLM prompt artifacts.
- Added local-only Source Control View auto refresh for local mirror changes and metadata-only remote checks.
- Cleaned up local mirror operation names and labels in Source Control View.
- Reduced TreeView context menus to primary actions and moved secondary actions into detail action surfaces.
- Always show target case information in the Test Case Actions Webview.
- Moved compare / apply decision actions from the Test Case Actions Webview to Source Control View.
- Added metadata display and an edit-basic-info action to the Test Case Actions Webview.
- Cleaned up Kiwi Plans context menu labels as target-specific action names.
- Always show plan information, descendant test case count, test run count, and local mirror summary in the Test Plan Actions Webview.
- Added primary case management, test run, and local mirror actions to the Test Plan Actions Webview.
- Split README into English and Japanese versions, and added a Japanese changelog.

## 0.0.4 (2026-04-19)

- Added plan context actions to compare and apply descendant local mirrors.
- Added Source Control resources for local mirror compare snapshots with `Compare Again`, `Upload Local Changes`, and `Take Remote Changes`.
- Prioritized compare snapshots in Explorer and aligned `Local Changes`, `Remote Changes`, and `Conflicts` with Source Control.
- Correctly detect remote-only case updates as `Remote Changes`, and keep comparison working where possible with older manifests.
- Open current remote latest versus local mirror diffs from `Remote Changes` instead of showing an empty diff.
- Moved SCM operation flow toward context menus and hid dedicated commands from the Command Palette.

## 0.0.3 (2026-04-16)

- Added Kiwi TCMS Template selection when creating new test cases.
- Added full body text search for test cases, with paged results in batches of 50.
- Improved history readability and history diff workflows.
- Made it easier to notice when an opened test case is no longer latest.
- Added bulk status and tag updates from the test case list.
- Grouped remove-from-plan and delete actions in the context menu.
- Added a dedicated screen to find and open Test Runs.
- Moved command names toward Japanese labels and aligned names such as `Find Test Cases` and `Find Test Runs`.
- Shortened context menu wording and aligned test plan / test case labels.

## 0.0.2 (2026-04-14)

- Made the case-focused multi-Test Run management initial view lighter while preserving existing all-plan search and plan selector behavior.
- Added support for showing diffs between a selected history body and the latest body from the case context menu.

## 0.0.1 (2026-04-12)

- Initial release.
- Added the `Kiwi Plans` view for browsing plans and cases.
- Added case open / save through `kiwi:` documents.
- Added case metadata editing, case creation / duplication, and plan add / remove operations.
- Added local mirror download / compare / upload.
