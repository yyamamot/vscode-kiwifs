import { KiwiCase, KiwiCaseCreatePayload, KiwiCaseMetadataPatch, KiwiTemplate } from "../types";
import { KiwiError } from "./errors";

export type EditableCaseMetadata = Pick<KiwiCase, "summary" | "status" | "priority" | "tags">;

export interface CaseMetadataFormState {
  summary: string;
  status: string;
  priority: string;
  tagsInput: string;
}

export const DEFAULT_CASE_BODY_TEMPLATE = `# Purpose

# Steps

# Expected Result
`;

export const DEFAULT_TEMPLATE_ID = "default";

export interface CaseTemplateOption {
  id: string;
  name: string;
  text: string;
  isDefault: boolean;
}

export function buildCaseTemplateOptions(
  templates: KiwiTemplate[],
  options: { defaultTemplateName?: string } = {}
): CaseTemplateOption[] {
  return [
    {
      id: DEFAULT_TEMPLATE_ID,
      name: options.defaultTemplateName ?? "Default Template",
      text: DEFAULT_CASE_BODY_TEMPLATE,
      isDefault: true
    },
    ...templates.map((template) => ({
      id: String(template.id),
      name: template.name,
      text: template.text,
      isDefault: false
    }))
  ];
}

export function resolveCaseTemplateText(
  options: CaseTemplateOption[],
  selectedTemplateId: string | undefined
): string {
  const defaultOption =
    options.find((option) => option.isDefault) ?? buildCaseTemplateOptions([])[0];
  return (
    options.find((option) => option.id === selectedTemplateId)?.text ??
    defaultOption.text
  );
}

export function toCaseMetadataFormState(caseData: EditableCaseMetadata): CaseMetadataFormState {
  return {
    summary: caseData.summary,
    status: caseData.status,
    priority: caseData.priority,
    tagsInput: normalizeTags(caseData.tags).join(", ")
  };
}

export function toEditableCaseMetadata(
  formState: CaseMetadataFormState,
  options: {
    statuses: string[];
    priorities: string[];
  }
): EditableCaseMetadata {
  const summary = formState.summary.trim();
  if (!summary) {
    throw new KiwiError("ValidationFailed", "Summary is required.");
  }
  if (!options.statuses.includes(formState.status)) {
    throw new KiwiError("ValidationFailed", `Status '${formState.status}' is invalid.`);
  }
  if (!options.priorities.includes(formState.priority)) {
    throw new KiwiError("ValidationFailed", `Priority '${formState.priority}' is invalid.`);
  }

  return {
    summary,
    status: formState.status,
    priority: formState.priority,
    tags: normalizeTags(
      formState.tagsInput
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  };
}

export function diffCaseMetadataPatch(
  before: EditableCaseMetadata,
  after: EditableCaseMetadata
): KiwiCaseMetadataPatch {
  const patch: KiwiCaseMetadataPatch = {};

  if (before.summary !== after.summary) {
    patch.summary = after.summary;
  }
  if (before.status !== after.status) {
    patch.status = after.status;
  }
  if (before.priority !== after.priority) {
    patch.priority = after.priority;
  }
  if (!arraysEqual(normalizeTags(before.tags), normalizeTags(after.tags))) {
    patch.tags = normalizeTags(after.tags);
  }

  return patch;
}

export function toCaseCreatePayload(
  formState: CaseMetadataFormState,
  options: {
    statuses: string[];
    priorities: string[];
  },
  text: string
): KiwiCaseCreatePayload {
  const metadata = toEditableCaseMetadata(formState, options);
  return {
    ...metadata,
    text
  };
}

export function normalizeTags(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
