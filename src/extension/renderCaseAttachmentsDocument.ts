import { KiwiCaseAttachment } from "../types";
import { toDisplayUrl } from "./displayUrl";

type CaseAttachmentsDocumentInput = {
  caseId: number;
  summary: string;
  attachments: KiwiCaseAttachment[];
};

export function renderCaseAttachmentsDocument(input: CaseAttachmentsDocumentInput): string {
  const { caseId, summary, attachments } = input;
  const lines = [
    `# Attachments: ${summary}`,
    "",
    `- caseId: ${caseId}`,
    "",
    "| Filename | Size | URL |",
    "| --- | --- | --- |"
  ];

  if (attachments.length === 0) {
    lines.push("| _(empty)_ | - | - |");
  } else {
    for (const attachment of attachments) {
      lines.push(
        `| ${escapeTable(attachment.filename)} | ${attachment.size ?? "-"} | ${escapeTable(
          attachment.downloadUrl ? toDisplayUrl(attachment.downloadUrl) : "-"
        )} |`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|");
}
