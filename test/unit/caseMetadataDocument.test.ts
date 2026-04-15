import { describe, expect, it } from "vitest";
import {
  buildCaseTemplateOptions,
  DEFAULT_CASE_BODY_TEMPLATE,
  DEFAULT_TEMPLATE_ID,
  diffCaseMetadataPatch,
  resolveCaseTemplateText,
  toCaseCreatePayload,
  toCaseMetadataFormState,
  toEditableCaseMetadata
} from "../../src/domain/caseMetadataDocument";

describe("caseMetadataDocument", () => {
  it("converts between editable metadata and form state", () => {
    const formState = toCaseMetadataFormState({
      summary: "Login works",
      status: "CONFIRMED",
      priority: "P1",
      tags: ["smoke", "regression"]
    });

    expect(formState).toEqual({
      summary: "Login works",
      status: "CONFIRMED",
      priority: "P1",
      tagsInput: "regression, smoke"
    });
    expect(
      toEditableCaseMetadata(formState, {
        statuses: ["CONFIRMED", "IDLE"],
        priorities: ["P1", "P2"]
      })
    ).toEqual({
      summary: "Login works",
      status: "CONFIRMED",
      priority: "P1",
      tags: ["regression", "smoke"]
    });
  });

  it("creates changed-only patch", () => {
    expect(
      diffCaseMetadataPatch(
        {
          summary: "Before",
          status: "CONFIRMED",
          priority: "P1",
          tags: ["smoke"]
        },
        {
          summary: "After",
          status: "IDLE",
          priority: "P2",
          tags: ["regression", "smoke"]
        }
      )
    ).toEqual({
      summary: "After",
      status: "IDLE",
      priority: "P2",
      tags: ["regression", "smoke"]
    });
  });

  it("creates case payload from form state", () => {
    expect(
      toCaseCreatePayload(
        {
          summary: " Login works copy ",
          status: "IDLE",
          priority: "P2",
          tagsInput: " smoke, regression, smoke "
        },
        {
          statuses: ["CONFIRMED", "IDLE"],
          priorities: ["P1", "P2"]
        },
        DEFAULT_CASE_BODY_TEMPLATE
      )
    ).toEqual({
      summary: "Login works copy",
      status: "IDLE",
      priority: "P2",
      tags: ["regression", "smoke"],
      text: DEFAULT_CASE_BODY_TEMPLATE
    });
  });

  it("builds template options with the default template first", () => {
    const options = buildCaseTemplateOptions([
      { id: 10, name: "Regression Template", text: "# Regression" }
    ]);

    expect(options).toEqual([
      {
        id: DEFAULT_TEMPLATE_ID,
        name: "既定テンプレート",
        text: DEFAULT_CASE_BODY_TEMPLATE,
        isDefault: true
      },
      {
        id: "10",
        name: "Regression Template",
        text: "# Regression",
        isDefault: false
      }
    ]);
  });

  it("resolves selected template text with default fallback", () => {
    const options = buildCaseTemplateOptions([
      { id: 10, name: "Regression Template", text: "# Regression" }
    ]);

    expect(resolveCaseTemplateText(options, "10")).toBe("# Regression");
    expect(resolveCaseTemplateText(options, "missing")).toBe(DEFAULT_CASE_BODY_TEMPLATE);
    expect(resolveCaseTemplateText(options, undefined)).toBe(DEFAULT_CASE_BODY_TEMPLATE);
  });
});
