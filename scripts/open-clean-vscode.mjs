import { spawn } from "node:child_process";
import { resolve } from "node:path";

const workspacePath = resolve(import.meta.dirname, "..");
const profileName = process.env.KIWIFS_VSCODE_PROFILE || "kiwifs-f5";
const disabledExtensions = (
  process.env.KIWIFS_DISABLED_EXTENSIONS ||
  "openai.chatgpt,GitHub.copilot,GitHub.copilot-chat,github.copilot,github.copilot-chat"
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const args = [
  "--profile",
  profileName,
  "--new-window",
  ...disabledExtensions.flatMap((id) => ["--disable-extension", id]),
  workspacePath
];

const child = spawn("code", args, {
  stdio: "inherit",
  detached: true
});

child.on("error", (error) => {
  console.error(`failed to launch VS Code: ${error.message}`);
  process.exitCode = 1;
});

child.on("spawn", () => {
  child.unref();
});
