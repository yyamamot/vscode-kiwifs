import { describe, expect, it } from "vitest";
import { renderCaseInfoDocument } from "../../src/extension/renderCaseInfoDocument";

describe("renderCaseInfoDocument", () => {
  it("renders read-only metadata fields", () => {
    const rendered = renderCaseInfoDocument({
      caseData: {
        id: 501,
        planId: 100,
        summary: "Login works",
        priority: "P1",
        category: "Functional",
        status: "CONFIRMED",
        components: ["Auth", "API"],
        tags: ["smoke"],
        notes: "Keep smoke coverage.",
        text: "# Body"
      },
      versionToken: "history_id:10"
    });

    expect(rendered).toContain("# Login works");
    expect(rendered).toContain("| summary | Login works |");
    expect(rendered).toContain("| components | Auth, API |");
    expect(rendered).toContain("| tags | smoke |");
    expect(rendered).toContain("| versionToken | history_id:10 |");
    expect(rendered).toContain("## Notes");
  });

  it("renders empty metadata fields predictably", () => {
    const rendered = renderCaseInfoDocument({
      caseData: {
        id: 1,
        planId: 2,
        summary: "Legacy case",
        priority: "",
        category: "",
        status: "",
        components: [],
        tags: [],
        notes: "",
        text: "body"
      },
      versionToken: "history_date:2026-04-06T00:00:00.000Z"
    });

    expect(rendered).toContain("| priority | - |");
    expect(rendered).toContain("| components | - |");
    expect(rendered).toContain("| tags | - |");
    expect(rendered).toContain("_(empty)_");
  });
});
