import { describe, expect, it } from "vitest";
import { renderCaseAttachmentsDocument } from "../../src/extension/renderCaseAttachmentsDocument";

describe("renderCaseAttachmentsDocument", () => {
  it("renders attachment table", () => {
    const content = renderCaseAttachmentsDocument({
      caseId: 501,
      summary: "Login works",
      attachments: [
        {
          filename: "screenshot.png",
          size: 1234,
          downloadUrl: "https://example.test/file"
        }
      ]
    });

    expect(content).toContain("# Attachments: Login works");
    expect(content).toContain("| screenshot.png | 1234 | https://example.test/file |");
  });

  it("renders empty placeholder", () => {
    const content = renderCaseAttachmentsDocument({
      caseId: 501,
      summary: "Login works",
      attachments: []
    });

    expect(content).toContain("| _(empty)_ | - | - |");
  });
});
