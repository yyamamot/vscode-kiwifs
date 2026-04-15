import * as vscode from "vscode";
import { KiwiCaseHistoryEntry } from "../types";

export type CaseHistoryQuickPickItem = vscode.QuickPickItem & {
  history: KiwiCaseHistoryEntry & { historyId: number };
};

export type CaseHistoryDiffTarget =
  | {
      kind: "history";
      historyId: number;
    }
  | {
      kind: "latest";
    };

export type CaseHistoryDiffPair = {
  left: KiwiCaseHistoryEntry & { historyId: number };
  right: CaseHistoryDiffTarget;
};

export type CaseHistoryDiffQuickPickItem = vscode.QuickPickItem & {
  pair: CaseHistoryDiffPair;
};

export function buildCaseHistoryQuickPickItems(history: KiwiCaseHistoryEntry[]): CaseHistoryQuickPickItem[] {
  return history
    .filter((entry): entry is KiwiCaseHistoryEntry & { historyId: number } => entry.historyId !== undefined)
    .map((entry) => ({
      label: `History ${entry.historyId}`,
      description: entry.historyDate,
      detail: [entry.historyType, entry.historyChangeReason].filter(Boolean).join(" / "),
      history: entry
    }));
}

export function buildCaseHistoryDiffQuickPickItems(
  history: KiwiCaseHistoryEntry[]
): CaseHistoryDiffQuickPickItem[] {
  const selectableHistory = sortableHistoryEntries(history);
  return selectableHistory.map((entry, index) => {
    const newerEntry = index === 0 ? undefined : selectableHistory[index - 1];
    const right: CaseHistoryDiffTarget = newerEntry
      ? { kind: "history", historyId: newerEntry.historyId }
      : { kind: "latest" };
    return {
      label: `History ${entry.historyId} → ${newerEntry ? `History ${newerEntry.historyId}` : "Latest"}`,
      description: `${entry.historyDate} → ${newerEntry?.historyDate ?? "Latest"}`,
      detail: [formatHistoryDetail(entry), newerEntry ? formatHistoryDetail(newerEntry) : "remote latest"]
        .filter(Boolean)
        .join(" → "),
      pair: {
        left: entry,
        right
      }
    };
  });
}

export function findCaseHistoryDiffPair(
  history: KiwiCaseHistoryEntry[],
  leftHistoryId: number
): CaseHistoryDiffPair | undefined {
  return buildCaseHistoryDiffQuickPickItems(history).find((item) => item.pair.left.historyId === leftHistoryId)?.pair;
}

function sortableHistoryEntries(history: KiwiCaseHistoryEntry[]): Array<KiwiCaseHistoryEntry & { historyId: number }> {
  return history
    .filter((entry): entry is KiwiCaseHistoryEntry & { historyId: number } => entry.historyId !== undefined)
    .sort((left, right) => {
      if (left.historyId !== right.historyId) {
        return right.historyId - left.historyId;
      }
      return right.historyDate.localeCompare(left.historyDate);
    });
}

function formatHistoryDetail(entry: KiwiCaseHistoryEntry): string {
  return [entry.historyType, entry.historyChangeReason].filter(Boolean).join(" / ");
}
