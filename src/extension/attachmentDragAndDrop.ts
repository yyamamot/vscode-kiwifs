import type * as vscode from "vscode";
import { KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";

export type UploadableAttachment = {
  filename: string;
  data: Uint8Array;
};

export function resolveAttachmentDropTarget(
  target: KiwiPlansTreeNode | undefined,
  selection: readonly KiwiPlansTreeNode[]
): Extract<KiwiPlansTreeNode, { kind: "case" }> | undefined {
  if (target?.kind === "case") {
    return target;
  }

  if (target) {
    return undefined;
  }

  const selectedCases = selection.filter(
    (item): item is Extract<KiwiPlansTreeNode, { kind: "case" }> => item.kind === "case"
  );
  return selectedCases.length === 1 ? selectedCases[0] : undefined;
}

export async function extractDroppedFiles(
  dataTransfer: vscode.DataTransfer
): Promise<UploadableAttachment[]> {
  const entries = Array.from(dataTransfer);
  const filesEntry = dataTransfer.get("files");
  if (filesEntry && !entries.some(([key, item]) => key === "files" || item === filesEntry)) {
    entries.push(["files", filesEntry]);
  }

  const result: UploadableAttachment[] = [];
  const seen = new Set<string>();
  for (const [, item] of entries) {
    const file = item.asFile();
    if (!file) {
      continue;
    }

    const data = await file.data();
    const dedupeKey = `${file.name}:${data.byteLength}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    result.push({
      filename: file.name,
      data
    });
  }
  return result;
}
