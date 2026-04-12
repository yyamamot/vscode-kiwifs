import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";
import {
  extractDroppedFiles,
  resolveAttachmentDropTarget
} from "../../src/extension/attachmentDragAndDrop";
import type { KiwiPlansTreeNode } from "../../src/extension/KiwiPlansTreeDataProvider";

describe("attachmentDragAndDrop", () => {
  const caseNode: KiwiPlansTreeNode = {
    kind: "case",
    plan: { id: 100, name: "Regression" },
    caseRef: { id: 501, summary: "Login works" }
  };
  const otherCaseNode: KiwiPlansTreeNode = {
    kind: "case",
    plan: { id: 100, name: "Regression" },
    caseRef: { id: 502, summary: "Password reset works" }
  };
  const planNode: KiwiPlansTreeNode = {
    kind: "plan",
    plan: { id: 100, name: "Regression" }
  };

  it("accepts direct case targets", () => {
    expect(resolveAttachmentDropTarget(caseNode, [])).toEqual(caseNode);
  });

  it("falls back to the single selected case when target is undefined", () => {
    expect(resolveAttachmentDropTarget(undefined, [caseNode])).toEqual(caseNode);
  });

  it("rejects plan targets even when a case is selected", () => {
    expect(resolveAttachmentDropTarget(planNode, [caseNode])).toBeUndefined();
  });

  it("rejects multiple selected cases when target is undefined", () => {
    expect(resolveAttachmentDropTarget(undefined, [caseNode, otherCaseNode])).toBeUndefined();
  });

  it("extracts files from iterated items", async () => {
    const files = await extractDroppedFiles(
      createDataTransfer({
        entries: [
          ["application/octet-stream", createFileItem("first.txt", "one")],
          ["text/plain", createFileItem("second.txt", "two")]
        ]
      }) as unknown as vscode.DataTransfer
    );

    expect(files.map((file) => file.filename)).toEqual(["first.txt", "second.txt"]);
    expect(Buffer.from(files[0]?.data ?? new Uint8Array()).toString("utf8")).toBe("one");
  });

  it("extracts files from the files mime fallback", async () => {
    const files = await extractDroppedFiles(
      createDataTransfer({
        entries: [],
        filesItem: createFileItem("fallback.txt", "fallback")
      }) as unknown as vscode.DataTransfer
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.filename).toBe("fallback.txt");
  });

  it("deduplicates the files mime entry when iteration already includes it", async () => {
    const duplicate = createFileItem("same.txt", "same");
    const files = await extractDroppedFiles(
      createDataTransfer({
        entries: [["files", duplicate]],
        filesItem: duplicate
      }) as unknown as vscode.DataTransfer
    );

    expect(files).toHaveLength(1);
  });

  it("returns empty when no files are present", async () => {
    const files = await extractDroppedFiles(
      createDataTransfer({ entries: [] }) as unknown as vscode.DataTransfer
    );
    expect(files).toEqual([]);
  });
});

function createDataTransfer(options: {
  entries: Array<[string, { asFile(): { name: string; data(): Promise<Uint8Array> } | undefined }]>;
  filesItem?: { asFile(): { name: string; data(): Promise<Uint8Array> } | undefined };
}) {
  return {
    get(value: string) {
      if (value === "files") {
        return options.filesItem;
      }
      return options.entries.find(([key]) => key === value)?.[1];
    },
    [Symbol.iterator]: function* () {
      yield* options.entries;
    }
  };
}

function createFileItem(name: string, content: string) {
  return {
    asFile() {
      return {
        name,
        data: async () => Buffer.from(content, "utf8")
      };
    }
  };
}
