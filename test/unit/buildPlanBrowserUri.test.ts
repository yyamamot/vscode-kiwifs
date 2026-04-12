import { describe, expect, it } from "vitest";
import { buildPlanBrowserUri } from "../../src/extension/buildPlanBrowserUri";

describe("buildPlanBrowserUri", () => {
  it("builds plan detail urls", () => {
    expect(buildPlanBrowserUri("https://kiwi.example.com", 100)).toBe(
      "https://kiwi.example.com/plan/100/"
    );
  });

  it("normalizes trailing slashes", () => {
    expect(buildPlanBrowserUri("https://kiwi.example.com/", 100)).toBe(
      "https://kiwi.example.com/plan/100/"
    );
  });
});
