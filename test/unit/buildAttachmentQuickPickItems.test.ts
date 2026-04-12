import { describe, expect, it } from "vitest";
import { buildAttachmentQuickPickItems } from "../../src/extension/buildAttachmentQuickPickItems";

describe("buildAttachmentQuickPickItems", () => {
  it("builds sorted quick pick items from browser-openable attachments", () => {
    const items = buildAttachmentQuickPickItems([
      {
        filename: "z-last.txt",
        size: 10,
        downloadUrl: "https://example.test/z"
      },
      {
        filename: "a-first.txt",
        size: 5,
        downloadUrl: "https://example.test/a"
      }
    ]);

    expect(items.map((item) => item.label)).toEqual(["a-first.txt", "z-last.txt"]);
    expect(items[0]?.description).toBe("5 bytes");
    expect(items[0]?.detail).toBe("https://example.test/a");
  });

  it("decodes percent-encoded urls for display only", () => {
    const items = buildAttachmentQuickPickItems([
      {
        filename: "jp.txt",
        downloadUrl:
          "https://example.test/uploads/ChatGPT%E9%80%A3%E5%8B%95%E6%96%B9%E6%B3%95.md"
      }
    ]);

    expect(items[0]?.detail).toBe("https://example.test/uploads/ChatGPT連動方法.md");
    expect(items[0]?.attachment.downloadUrl).toBe(
      "https://example.test/uploads/ChatGPT%E9%80%A3%E5%8B%95%E6%96%B9%E6%B3%95.md"
    );
  });

  it("filters attachments without download urls", () => {
    const items = buildAttachmentQuickPickItems([
      {
        filename: "missing-url.txt"
      },
      {
        filename: "ok.txt",
        downloadUrl: "https://example.test/file"
      }
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("ok.txt");
  });
});
