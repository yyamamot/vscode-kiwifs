import * as assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildCaseBrowserUri } from "../../src/extension/buildCaseBrowserUri";

describe("buildCaseBrowserUri", () => {
  it("builds a view url for a case id", () => {
    assert.equal(
      buildCaseBrowserUri("https://kiwi.example.test/", 501),
      "https://kiwi.example.test/case/501/"
    );
  });

  it("is stable regardless of trailing slash", () => {
    assert.equal(
      buildCaseBrowserUri("https://kiwi.example.test", 501),
      "https://kiwi.example.test/case/501/"
    );
  });
});
