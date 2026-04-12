import { describe, expect, it } from "vitest";
import { renderPlanInfoDocument } from "../../src/extension/renderPlanInfoDocument";

describe("renderPlanInfoDocument", () => {
  it("renders id name and text as markdown", () => {
    const content = renderPlanInfoDocument({
      plan: {
        id: 100,
        name: "Regression",
        text: "Plan body"
      }
    });

    expect(content).toContain("# Regression");
    expect(content).toContain("- id: 100");
    expect(content).toContain("## Text");
    expect(content).toContain("Plan body");
  });

  it("renders empty placeholder when text is missing", () => {
    const content = renderPlanInfoDocument({
      plan: {
        id: 100,
        name: "Regression",
        text: ""
      }
    });

    expect(content).toContain("_(empty)_");
  });
});
