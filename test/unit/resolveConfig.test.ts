import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeBaseUrlInput,
  normalizeSecretInput
} from "../../src/config/configInput";
import { resolveKiwiConfig } from "../../src/config/resolveConfig";

let configurationValues = new Map<string, string>();

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (name: string) => configurationValues.get(name) ?? ""
    }),
    workspaceFolders: [],
    workspaceFile: undefined
  }
}));

describe("resolveConfig helpers", () => {
  const originalRuntimeMode = process.env.KIWI_RUNTIME_MODE;
  const originalBaseUrl = process.env.KIWI_BASE_URL;
  const originalUsername = process.env.KIWI_USERNAME;
  const originalPassword = process.env.KIWI_PASSWORD;

  beforeEach(() => {
    configurationValues = new Map<string, string>();
    delete process.env.KIWI_RUNTIME_MODE;
    delete process.env.KIWI_BASE_URL;
    delete process.env.KIWI_USERNAME;
    delete process.env.KIWI_PASSWORD;
  });

  afterEach(() => {
    restoreEnv("KIWI_RUNTIME_MODE", originalRuntimeMode);
    restoreEnv("KIWI_BASE_URL", originalBaseUrl);
    restoreEnv("KIWI_USERNAME", originalUsername);
    restoreEnv("KIWI_PASSWORD", originalPassword);
  });

  it("normalizes valid http/https base urls", () => {
    expect(normalizeBaseUrlInput("https://kiwi.example.com/")).toBe("https://kiwi.example.com");
    expect(normalizeBaseUrlInput("http://localhost:8443/")).toBe("http://localhost:8443");
  });

  it("rejects invalid base urls", () => {
    expect(normalizeBaseUrlInput("")).toBeUndefined();
    expect(normalizeBaseUrlInput("ftp://kiwi.example.com/")).toBeUndefined();
    expect(normalizeBaseUrlInput("not-a-url")).toBeUndefined();
  });

  it("trims and validates secret inputs", () => {
    expect(normalizeSecretInput(" admin ")).toBe("admin");
    expect(normalizeSecretInput("   ")).toBeUndefined();
  });

  it("ignores process env outside debug-f5 mode", async () => {
    process.env.KIWI_RUNTIME_MODE = "production";
    process.env.KIWI_BASE_URL = "https://env.example/";
    process.env.KIWI_USERNAME = "admin";
    process.env.KIWI_PASSWORD = "admin";

    await expect(resolveKiwiConfig(fakeContext())).rejects.toThrow(
      /Kiwi configuration is incomplete/
    );
  });

  it("uses process env only in debug-f5 mode", async () => {
    process.env.KIWI_RUNTIME_MODE = "debug-f5";
    process.env.KIWI_BASE_URL = "https://env.example/";
    process.env.KIWI_USERNAME = "admin";
    process.env.KIWI_PASSWORD = "admin";

    await expect(resolveKiwiConfig(fakeContext())).resolves.toEqual({
      baseUrl: "https://env.example",
      username: "admin",
      password: "admin"
    });
  });
});

function fakeContext() {
  return {
    secrets: {
      get: vi.fn(async () => undefined)
    }
  } as unknown as Parameters<typeof resolveKiwiConfig>[0];
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
