import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { createAdapter } from "../../src/adapter/createAdapter";
import { MockFileAdapter } from "../../src/adapter/mockFileAdapter";
import { RealKiwiAdapter } from "../../src/adapter/realKiwiAdapter";

describe("createAdapter", () => {
  const originalRuntimeMode = process.env.KIWI_RUNTIME_MODE;
  const originalMockStatePath = process.env.KIWI_MOCK_STATE_PATH;

  beforeEach(() => {
    delete process.env.KIWI_RUNTIME_MODE;
    delete process.env.KIWI_MOCK_STATE_PATH;
  });

  afterEach(() => {
    restoreEnv("KIWI_RUNTIME_MODE", originalRuntimeMode);
    restoreEnv("KIWI_MOCK_STATE_PATH", originalMockStatePath);
  });

  it("uses real adapter for http urls", () => {
    expect(createAdapter("https://kiwi.example")).toBeInstanceOf(RealKiwiAdapter);
  });

  it("rejects mock adapter outside debug-f5 mode", () => {
    process.env.KIWI_MOCK_STATE_PATH = path.join(os.tmpdir(), "mock-state.json");

    expect(() => createAdapter("mock://default")).toThrow(
      /mock:\/\/ adapter is available only in debug-f5 mode/
    );
  });

  it("requires absolute mock state path in debug-f5 mode", () => {
    process.env.KIWI_RUNTIME_MODE = "debug-f5";
    process.env.KIWI_MOCK_STATE_PATH = "mock-state.json";

    expect(() => createAdapter("mock://default")).toThrow(
      /KIWI_MOCK_STATE_PATH must be an absolute path/
    );
  });

  it("creates mock adapter only for debug-f5 with absolute state path", () => {
    process.env.KIWI_RUNTIME_MODE = "debug-f5";
    process.env.KIWI_MOCK_STATE_PATH = path.join(os.tmpdir(), "mock-state.json");

    expect(createAdapter("mock://default")).toBeInstanceOf(MockFileAdapter);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
