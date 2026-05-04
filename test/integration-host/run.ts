import * as path from "node:path";
import * as os from "node:os";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index.js");
  const runtimeLogDir = mkdtempSync(path.join(os.tmpdir(), "kiwifs-log-"));
  const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), "kiwifs-runtime-root-"));
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "kiwifs-workspace-"));
  const workspacePath = path.join(workspaceDir, "integration-host.code-workspace");
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "kiwifs-user-data-"));
  const extensionsDir = mkdtempSync(path.join(os.tmpdir(), "kiwifs-extensions-"));
  const userSettingsDir = path.join(userDataDir, "User");
  writeFileSync(
    path.join(runtimeRoot, ".env"),
    [
      "KIWI_BASE_URL=https://env.example/",
      "KIWI_USERNAME=admin",
      "KIWI_PASSWORD=admin"
    ].join("\n") + "\n",
    "utf8"
  );
  writeFileSync(
    workspacePath,
    JSON.stringify(
      {
        folders: [{ path: extensionDevelopmentPath }]
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  mkdirSync(userSettingsDir, { recursive: true });
  writeFileSync(
    path.join(userSettingsDir, "settings.json"),
    JSON.stringify(
      {
        "window.restoreWindows": "none",
        "extensions.autoCheckUpdates": false,
        "extensions.autoUpdate": false,
        "extensions.ignoreRecommendations": true,
        "workbench.secondarySideBar.defaultVisibility": "hidden",
        "chat.agent.enabled": false,
        "chat.agentHost.enabled": false,
        "chat.agentsControl.enabled": false,
        "chat.commandCenter.enabled": false,
        "chat.viewSessions.enabled": false,
        "github.copilot.enable": { "*": false },
        "github.copilot.nextEditSuggestions.enabled": false,
        "github.copilot.chat.backgroundAgent.enabled": false,
        "github.copilot.chat.claudeAgent.enabled": false,
        "github.copilot.chat.cloudAgent.enabled": false
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      "--user-data-dir",
      userDataDir,
      "--force-disable-user-env",
      "--new-window",
      "--disable-extensions",
      "--disable-extension",
      "openai.chatgpt",
      "--disable-extension",
      "GitHub.copilot",
      "--disable-extension",
      "GitHub.copilot-chat",
      "--disable-extension",
      "github.copilot",
      "--disable-extension",
      "github.copilot-chat",
      "--extensions-dir",
      extensionsDir,
      workspacePath
    ],
    extensionTestsEnv: {
      KIWI_MOCK_STATE_PATH: process.env.KIWI_MOCK_STATE_PATH ?? "",
      KIWI_RUNTIME_MODE: process.env.KIWI_RUNTIME_MODE ?? "debug-f5",
      KIWI_RUNTIME_ROOT: process.env.KIWI_RUNTIME_ROOT ?? runtimeRoot,
      KIWI_JSONL_PATH:
        process.env.KIWI_JSONL_PATH ?? path.join(runtimeLogDir, "runtime.jsonl"),
      ...forwardEnv([
        "KIWIFS_HOST_SUITE_MODE",
        "KIWIFS_UI_REVIEW_SCENARIO_PATH",
        "KIWIFS_UI_REVIEW_SNAPSHOT_PATH",
        "KIWIFS_UI_REVIEW_SCREENSHOT_PATH",
        "KIWIFS_UI_REVIEW_WORKSPACE_STATE_PATH",
        "KIWIFS_UI_REVIEW_COMMAND_TRACE_PATH",
        "KIWIFS_UI_REVIEW_UI_STATE_PATH",
        "KIWIFS_UI_REVIEW_NATIVE_CONTEXT_MENU_REPORT_PATH"
      ])
    }
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function forwardEnv(names: string[]): Record<string, string> {
  return Object.fromEntries(
    names
      .map((name) => [name, process.env[name]] as const)
      .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string")
  );
}
