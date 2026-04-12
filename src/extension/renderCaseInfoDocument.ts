import { KiwiCase } from "../types";

type CaseInfoDocumentInput = {
  caseData: KiwiCase;
  versionToken: string;
};

export function renderCaseInfoDocument(input: CaseInfoDocumentInput): string {
  const { caseData, versionToken } = input;

  return [
    `# ${caseData.summary}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| id | ${caseData.id} |`,
    `| planId | ${caseData.planId} |`,
    `| summary | ${escapeTable(caseData.summary)} |`,
    `| priority | ${escapeTable(orDash(caseData.priority))} |`,
    `| category | ${escapeTable(orDash(caseData.category))} |`,
    `| status | ${escapeTable(orDash(caseData.status))} |`,
    `| components | ${escapeTable(listValue(caseData.components))} |`,
    `| tags | ${escapeTable(listValue(caseData.tags))} |`,
    `| versionToken | ${escapeTable(versionToken)} |`,
    "",
    "## Notes",
    "",
    caseData.notes.trim() ? caseData.notes : "_(empty)_",
    ""
  ].join("\n");
}

function listValue(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function orDash(value: string): string {
  return value.trim() ? value : "-";
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|");
}
