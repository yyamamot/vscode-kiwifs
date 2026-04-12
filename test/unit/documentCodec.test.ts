import { describe, expect, it } from "vitest";
import { parseCaseDocument, renderCaseDocument } from "../../src/domain/documentCodec";

describe("documentCodec", () => {
  it("renders and parses a freeform case document body", () => {
    const rendered = renderCaseDocument({
      body: "# Existing Kiwi body\n\n1. Open login page\n2. Sign in"
    });

    const parsed = parseCaseDocument(rendered);
    expect(parsed.body).toBe("# Existing Kiwi body\n\n1. Open login page\n2. Sign in");
  });
});
