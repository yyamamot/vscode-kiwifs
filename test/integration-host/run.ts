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
        "window.restoreWindows": "none"
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
      workspacePath
    ],
    extensionTestsEnv: {
      KIWI_MOCK_STATE_PATH: process.env.KIWI_MOCK_STATE_PATH ?? "",
      KIWI_RUNTIME_MODE: process.env.KIWI_RUNTIME_MODE ?? "debug-f5",
      KIWI_RUNTIME_ROOT: process.env.KIWI_RUNTIME_ROOT ?? runtimeRoot,
      KIWI_JSONL_PATH:
        process.env.KIWI_JSONL_PATH ?? path.join(runtimeLogDir, "runtime.jsonl")
    }
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
