import * as path from "node:path";
import { KiwiPlan, PlanCaseRef } from "../types";

export function sanitizeSegment(value: string): string {
  return value.replace(/[\\/:\n\r\t?*<>|"]/g, "_").trim();
}

export function planDirectoryName(plan: KiwiPlan): string {
  return `${plan.id} - ${sanitizeSegment(plan.name)}`;
}

export function caseFileName(caseRef: PlanCaseRef): string {
  return `${caseRef.id} - ${sanitizeSegment(caseRef.summary)}.md`;
}

export function parseNumericPrefix(value: string): number | undefined {
  const match = /^(\d+)/.exec(path.basename(value));
  return match ? Number(match[1]) : undefined;
}
