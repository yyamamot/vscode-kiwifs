import { describe, expect, it } from "vitest";
import {
  classifyAttachmentEditorView,
  inferAttachmentLanguage,
  type AttachmentEditorViewKind
} from "../../src/extension/attachmentEditorSupport";

describe("attachmentEditorSupport", () => {
  it("infers language from filename", () => {
    expect(inferAttachmentLanguage("notes.md")).toBe("markdown");
    expect(inferAttachmentLanguage("payload.json")).toBe("json");
    expect(inferAttachmentLanguage("plain.unknown")).toBe("plaintext");
  });

  it("classifies text attachments for inline editor view", () => {
    expect(classify("notes.md", "text/markdown; charset=utf-8")).toBe("text");
    expect(classify("payload.json", "application/json")).toBe("text");
  });

  it("classifies image and pdf attachments as previewable binary", () => {
    expect(classify("diagram.png", "image/png")).toBe("preview-image");
    expect(classify("vector.svg", "image/svg+xml")).toBe("preview-image");
    expect(classify("report.pdf", "application/pdf")).toBe("preview-pdf");
  });

  it("uses extension fallback for previewable binary when content-type is wrong", () => {
    expect(classify("diagram.png", "text/plain")).toBe("preview-image");
    expect(classify("vector.svg", "text/plain")).toBe("preview-image");
  });

  it("falls back to extension when content-type is missing", () => {
    expect(classify("notes.txt")).toBe("text");
    expect(classify("diagram.png")).toBe("preview-image");
    expect(classify("archive.bin")).toBe("unsupported");
  });
});

function classify(filename: string, contentType?: string): AttachmentEditorViewKind {
  return classifyAttachmentEditorView(
    {
      contentType,
      body: Buffer.from("body", "utf8")
    },
    filename
  );
}
