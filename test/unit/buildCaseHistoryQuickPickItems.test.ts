import { describe, expect, it } from "vitest";
import {
  buildCaseHistoryDiffQuickPickItems,
  buildCaseHistoryQuickPickItems,
  findCaseHistoryDiffPair
} from "../../src/extension/buildCaseHistoryQuickPickItems";

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

  it("builds one-step diff pairs from selectable history entries", () => {
    const items = buildCaseHistoryDiffQuickPickItems([
      {
        historyId: 10,
        historyDate: "2026-04-11T18:00:00.000Z",
        historyType: "+",
        historyChangeReason: "create"
      },
      {
        historyId: 12,
        historyDate: "2026-04-11T20:00:00.000Z",
        historyType: "~",
        historyChangeReason: "second update"
      },
      {
        historyDate: "2026-04-11T21:00:00.000Z"
      },
      {
        historyId: 11,
        historyDate: "2026-04-11T19:00:00.000Z",
        historyType: "~",
        historyChangeReason: "first update"
      }
    ]);

    expect(items.map((item) => ({
      label: item.label,
      description: item.description,
      detail: item.detail,
      left: item.pair.left.historyId,
      right: item.pair.right
    }))).toEqual([
      {
        label: "History 12 → Latest",
        description: "2026-04-11T20:00:00.000Z → Latest",
        detail: "~ / second update → remote latest",
        left: 12,
        right: { kind: "latest" }
      },
      {
        label: "History 11 → History 12",
        description: "2026-04-11T19:00:00.000Z → 2026-04-11T20:00:00.000Z",
        detail: "~ / first update → ~ / second update",
        left: 11,
        right: { kind: "history", historyId: 12 }
      },
      {
        label: "History 10 → History 11",
        description: "2026-04-11T18:00:00.000Z → 2026-04-11T19:00:00.000Z",
        detail: "+ / create → ~ / first update",
        left: 10,
        right: { kind: "history", historyId: 11 }
      }
    ]);
  });

  it("finds a diff pair by left history id", () => {
    expect(
      findCaseHistoryDiffPair(
        [
          { historyId: 10, historyDate: "2026-04-11T18:00:00.000Z" },
          { historyId: 11, historyDate: "2026-04-11T19:00:00.000Z" }
        ],
        10
      )
    ).toEqual({
      left: {
        historyId: 10,
        historyDate: "2026-04-11T18:00:00.000Z"
      },
      right: { kind: "history", historyId: 11 }
    });
  });
});
