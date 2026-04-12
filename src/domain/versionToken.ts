import { KiwiCaseHistoryEntry } from "../types";
import { KiwiError } from "./errors";

export function deriveVersionToken(history: KiwiCaseHistoryEntry[]): string {
  if (history.length === 0) {
    throw new KiwiError("ValidationFailed", "History must not be empty.");
  }

  const latest = history[0];
  if (latest.historyId !== undefined) {
    return `history_id:${latest.historyId}`;
  }

  if (latest.historyDate) {
    if (latest.historyChangeReason) {
      return `history_date:${latest.historyDate}|reason:${latest.historyChangeReason}`;
    }

    return `history_date:${latest.historyDate}`;
  }

  throw new KiwiError("ValidationFailed", "History entry is missing version fields.");
}
