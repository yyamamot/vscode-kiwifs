import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function readManifest() {
  const manifestPath = path.resolve(process.cwd(), "package.json");
  const manifestText = readFileSync(manifestPath, "utf8");
  return JSON.parse(manifestText);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveVsixPath(manifest) {
  return path.resolve(process.cwd(), `${manifest.name}-${manifest.version}.vsix`);
}

function resolveExtensionId(manifest) {
  const publisher = manifest.publisher ?? "undefined_publisher";
  return `${publisher}.${manifest.name}`;
}

function ensureCodeCli() {
  const probe = spawnSync("code", ["--version"], {
    encoding: "utf8",
    stdio: "ignore"
  });
  if (probe.status !== 0) {
    console.error(
      "VS Code CLI `code` が見つかりません。Command Palette から 'Shell Command: Install code command in PATH' を実行してください。"
    );
    process.exit(1);
  }
}

function packageVsix(manifest) {
  run("pnpm", ["run", "build"]);
  run("pnpm", [
    "exec",
    "vsce",
    "package",
    "--no-dependencies",
    "--allow-missing-repository",
    "--skip-license"
  ]);
  const vsixPath = resolveVsixPath(manifest);
  if (!existsSync(vsixPath)) {
    console.error(`VSIX が見つかりません: ${vsixPath}`);
    process.exit(1);
  }
  console.log(vsixPath);
}

function installVsix(manifest) {
  ensureCodeCli();
  const vsixPath = resolveVsixPath(manifest);
  if (!existsSync(vsixPath)) {
    packageVsix(manifest);
  }
  run("code", ["--install-extension", vsixPath, "--force"]);
}

function uninstallVsix(manifest) {
  ensureCodeCli();
  run("code", ["--uninstall-extension", resolveExtensionId(manifest)]);
}

const manifest = readManifest();
const command = process.argv[2];

if (command === "package") {
  packageVsix(manifest);
} else if (command === "install") {
  installVsix(manifest);
} else if (command === "uninstall") {
  uninstallVsix(manifest);
} else {
  console.error("Usage: node ./scripts/vsix.mjs <package|install|uninstall>");
  process.exit(1);
}
