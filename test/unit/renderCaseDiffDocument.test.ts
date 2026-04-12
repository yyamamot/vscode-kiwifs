import { describe, expect, it } from "vitest";
import { renderCaseDiffDocument, renderCaseDiffTitle } from "../../src/extension/renderCaseDiffDocument";

describe("renderCaseDiffDocument", () => {
  it("returns the body unchanged", () => {
    expect(renderCaseDiffDocument({ body: "# Heading\n\nBody" })).toBe("# Heading\n\nBody");
  });

  it("renders a stable diff title", () => {
    expect(renderCaseDiffTitle("Login works")).toBe("Login works (Local ↔ Remote)");
  });
});
