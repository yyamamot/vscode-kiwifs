import { KiwiCaseHistoryEntry } from "../types";

type CaseHistoryDocumentInput = {
  caseId: number;
  summary: string;
  history: KiwiCaseHistoryEntry[];
};

export function renderCaseHistoryDocument(input: CaseHistoryDocumentInput): string {
  const sortedHistory = [...input.history].sort(compareHistoryDesc);
  const lines = [
    `# History: ${input.summary}`,
    "",
    `- caseId: ${input.caseId}`,
    ""
  ];

  if (sortedHistory.length === 0) {
    lines.push("履歴はありません。");
  } else {
    for (const [index, entry] of sortedHistory.entries()) {
      if (index > 0) {
        lines.push("", "---", "");
      }
      lines.push(
        `## History ${entry.historyId ?? "-"}`,
        "",
        `- history_id: ${entry.historyId ?? "-"}`,
        `- date: ${entry.historyDate}`,
        `- type: ${orDash(entry.historyType)}`,
        `- reason: ${orDash(entry.historyChangeReason)}`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

function compareHistoryDesc(left: KiwiCaseHistoryEntry, right: KiwiCaseHistoryEntry): number {
  const leftId = left.historyId ?? -1;
  const rightId = right.historyId ?? -1;
  if (leftId !== rightId) {
    return rightId - leftId;
  }
  return right.historyDate.localeCompare(left.historyDate);
}

function orDash(value: string | undefined): string {
  return value?.trim() ? value : "-";
}
