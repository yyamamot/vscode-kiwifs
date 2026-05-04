import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let mockWorkspaceFolders: Array<{ uri: { scheme: string; fsPath: string } }> = [];
let mockWorkspaceFile: { scheme: string; fsPath: string } | undefined;

vi.mock("vscode", () => ({
  workspace: {
    get workspaceFolders() {
      return mockWorkspaceFolders;
    },
    get workspaceFile() {
      return mockWorkspaceFile;
    }
  }
}));

describe("localEnv", () => {
  let tempRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.resetModules();
    mockWorkspaceFolders = [];
    mockWorkspaceFile = undefined;
    delete process.env.KIWI_RUNTIME_ROOT;
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "kiwifs-local-env-"));
    originalCwd = process.cwd();
    process.chdir(tempRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("resolves .env from KIWI_RUNTIME_ROOT first", async () => {
    const runtimeRoot = path.join(tempRoot, "runtime-root");
    const workspaceRoot = path.join(tempRoot, "workspace-root");
    mkdirSync(runtimeRoot, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(path.join(runtimeRoot, ".env"), "KIWI_BASE_URL=https://runtime.example/\n", "utf8");
    writeFileSync(path.join(workspaceRoot, ".env"), "KIWI_BASE_URL=https://workspace.example/\n", "utf8");
    process.env.KIWI_RUNTIME_ROOT = runtimeRoot;
    mockWorkspaceFolders = [{ uri: { scheme: "file", fsPath: workspaceRoot } }];

    const { localEnvValue, resolveLocalEnvPath, isLocalEnvResolved } = await import("../../src/config/localEnv");

    expect(resolveLocalEnvPath()).toBe(path.join(runtimeRoot, ".env"));
    expect(localEnvValue("KIWI_BASE_URL")).toBe("https://runtime.example/");
    expect(isLocalEnvResolved()).toBe(true);
  });

  it("falls back to workspace when KIWI_RUNTIME_ROOT is absent", async () => {
    const workspaceRoot = path.join(tempRoot, "workspace-root");
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(path.join(workspaceRoot, ".env"), "KIWI_USERNAME=admin\n", "utf8");
    mockWorkspaceFolders = [{ uri: { scheme: "file", fsPath: workspaceRoot } }];

    const { localEnvValue, resolveLocalEnvPath } = await import("../../src/config/localEnv");

    expect(resolveLocalEnvPath()).toBe(path.join(workspaceRoot, ".env"));
    expect(localEnvValue("KIWI_USERNAME")).toBe("admin");
  });

  it("returns undefined when no .env is available", async () => {
    const { localEnvValue, resolveLocalEnvPath, isLocalEnvResolved } = await import("../../src/config/localEnv");

    expect(resolveLocalEnvPath()).toBeUndefined();
    expect(localEnvValue("KIWI_PASSWORD")).toBeUndefined();
    expect(isLocalEnvResolved()).toBe(false);
  });

  it("does not resolve .env from process cwd", async () => {
    writeFileSync(path.join(tempRoot, ".env"), "KIWI_BASE_URL=https://cwd.example/\n", "utf8");

    const { localEnvValue, resolveLocalEnvPath, isLocalEnvResolved } = await import("../../src/config/localEnv");

    expect(resolveLocalEnvPath()).toBeUndefined();
    expect(localEnvValue("KIWI_BASE_URL")).toBeUndefined();
    expect(isLocalEnvResolved()).toBe(false);
  });
});
