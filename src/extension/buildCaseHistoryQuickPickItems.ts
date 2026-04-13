import * as vscode from "vscode";
import { KiwiCaseHistoryEntry } from "../types";

export type CaseHistoryQuickPickItem = vscode.QuickPickItem & {
  history: KiwiCaseHistoryEntry & { historyId: number };
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
