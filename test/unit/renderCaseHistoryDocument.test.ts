import { describe, expect, it } from "vitest";
import { renderCaseHistoryDocument } from "../../src/extension/renderCaseHistoryDocument";

describe("renderCaseHistoryDocument", () => {
  it("renders history entries as stable read-only markdown cards", () => {
    const rendered = renderCaseHistoryDocument({
      caseId: 501,
      summary: "Login works",
      history: [
        {
          historyId: 10,
          historyDate: "2026-04-05T00:00:00.000Z",
          historyType: "~",
          historyChangeReason: "body update"
        },
        {
          historyDate: "2026-04-06T00:00:00.000Z",
          historyChangeReason: "reason | with pipe"
        },
        {
          historyId: 11,
          historyDate: "2026-04-07T00:00:00.000Z"
        }
      ]
    });

    expect(rendered).toContain("# History: Login works");
    expect(rendered).toContain("- caseId: 501");
    expect(rendered).toContain("## History 11");
    expect(rendered).toContain("- history_id: 11");
    expect(rendered).toContain("- date: 2026-04-07T00:00:00.000Z");
    expect(rendered).toContain("- type: -");
    expect(rendered).toContain("- reason: -");
    expect(rendered).toContain("## History 10");
    expect(rendered).toContain("- reason: body update");
    expect(rendered).toContain("## History -");
    expect(rendered).toContain("- reason: reason | with pipe");
    expect(rendered).toContain("\n---\n");
    expect(rendered.indexOf("## History 11")).toBeLessThan(rendered.indexOf("## History 10"));
  });

  it("renders an empty state when history is unavailable", () => {
    expect(
      renderCaseHistoryDocument({
        caseId: 501,
        summary: "Login works",
        history: []
      })
    ).toContain("履歴はありません。");
  });
});
