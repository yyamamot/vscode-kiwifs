import { describe, expect, it } from "vitest";
import { buildCaseHistoryQuickPickItems } from "../../src/extension/buildCaseHistoryQuickPickItems";

describe("buildCaseHistoryQuickPickItems", () => {
  it("builds stable labels and details for selectable history entries", () => {
    const items = buildCaseHistoryQuickPickItems([
      {
        historyId: 272,
        historyDate: "2026-04-11T18:58:29.000Z",
        historyType: "~",
        historyChangeReason: "body update"
      },
      {
        historyDate: "2026-04-11T18:00:00.000Z"
      }
    ]);

    expect(items.map((item) => ({
      label: item.label,
      description: item.description,
      detail: item.detail,
      historyId: item.history.historyId
    }))).toEqual([
      {
        label: "History 272",
        description: "2026-04-11T18:58:29.000Z",
        detail: "~ / body update",
        historyId: 272
      }
    ]);
  });
});
