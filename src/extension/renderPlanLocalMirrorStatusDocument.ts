import * as path from "node:path";
import { LocalMirrorPlanStatusRow } from "./localMirrorService";

export function renderPlanLocalMirrorStatusDocument(input: {
  plan: { id: number; name: string };
  rows: LocalMirrorPlanStatusRow[];
}): string {
  const lines = [
    `# Local Mirror Status: ${input.plan.name}`,
    "",
    `- planId: ${input.plan.id}`,
    `- cases: ${input.rows.length}`,
    "",
    "| caseId | summary | status | localPath |",
    "| --- | --- | --- | --- |"
  ];

  for (const row of input.rows) {
    lines.push(
      `| ${row.caseId} | ${escapeTable(row.summary)} | ${row.status} | ${escapeTable(path.normalize(row.localPath))} |`
    );
  }

  if (input.rows.length === 0) {
    lines.push("| - | No cases found. | - | - |");
  }

  return `${lines.join("\n")}\n`;
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|");
}
