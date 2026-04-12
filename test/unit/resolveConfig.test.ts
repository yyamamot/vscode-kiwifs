import { describe, expect, it } from "vitest";
import { normalizeBaseUrlInput, normalizeSecretInput } from "../../src/config/configInput";

describe("resolveConfig helpers", () => {
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
});
