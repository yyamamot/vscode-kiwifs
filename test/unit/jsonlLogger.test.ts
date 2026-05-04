import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [],
    workspaceFile: undefined,
    getConfiguration: () => ({
      get: () => ""
    })
  }
}));

describe("jsonlLogger path resolution", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not resolve relative path from workspace folder", async () => {
    const { resolveRuntimeLogPath } = await import("../../src/logging/jsonlLogger");
    expect(
      resolveRuntimeLogPath(".kiwi-logs/runtime/run.jsonl", {
        workspaceFolderFsPath: "/tmp/workspace"
      })
    ).toBeUndefined();
  });

  it("does not resolve relative path from workspace file directory", async () => {
    const { resolveRuntimeLogPath } = await import("../../src/logging/jsonlLogger");
    expect(
      resolveRuntimeLogPath(".kiwi-logs/runtime/run.jsonl", {
        workspaceFileFsPath: "/tmp/workspace/project.code-workspace"
      })
    ).toBeUndefined();
  });

  it("returns undefined when workspace context is unavailable", async () => {
    const { resolveRuntimeLogPath, defaultRuntimeLogDirectory } = await import("../../src/logging/jsonlLogger");
    expect(resolveRuntimeLogPath(".kiwi-logs/runtime/run.jsonl", {})).toBeUndefined();
    expect(defaultRuntimeLogDirectory({})).toBeUndefined();
  });

  it("resolves default runtime path from runtime root first", async () => {
    const { resolveRuntimeLogPath, defaultRuntimeLogPath } = await import("../../src/logging/jsonlLogger");
    expect(
      resolveRuntimeLogPath(defaultRuntimeLogPath(), {
        runtimeRootFsPath: "/tmp/runtime-root",
        workspaceFolderFsPath: "/tmp/workspace"
      })
    ).toMatch(/^\/tmp\/runtime-root\/\.kiwi-logs\/runtime\/run-/);
  });

  it("prefers absolute KIWI_JSONL_PATH over runtime root", async () => {
    const { resolveRuntimeLogPath } = await import("../../src/logging/jsonlLogger");
    expect(
      resolveRuntimeLogPath("/tmp/absolute/runtime.jsonl", {
        runtimeRootFsPath: "/tmp/runtime-root",
        workspaceFolderFsPath: "/tmp/workspace"
      })
    ).toBe("/tmp/absolute/runtime.jsonl");
  });

  it("resolves relative KIWI_JSONL_PATH from runtime root", async () => {
    const { resolveRuntimeLogPath } = await import("../../src/logging/jsonlLogger");
    expect(
      resolveRuntimeLogPath(".kiwi-logs/custom/runtime.jsonl", {
        runtimeRootFsPath: "/tmp/runtime-root",
        workspaceFolderFsPath: "/tmp/workspace"
      })
    ).toBe("/tmp/runtime-root/.kiwi-logs/custom/runtime.jsonl");
  });
});
