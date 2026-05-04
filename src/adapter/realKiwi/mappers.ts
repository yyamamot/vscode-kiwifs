import { KiwiCaseAttachment, KiwiCaseExecution, KiwiCaseHistoryEntry, KiwiCaseSearchMode, KiwiCaseSearchResult, KiwiPlan, KiwiTemplate, KiwiTestRun } from "../../types";
import { KiwiError } from "../../domain/errors";
import { filenameFromUrl } from "./attachmentApi";

type RpcStruct = Record<string, unknown>;

export function mapPlanRecord(record: RpcStruct): KiwiPlan {
  return {
    id: asNumber(record.id, "id"),
    name: asString(record.name, "name"),
    text: optionalString(record.text)
  };
}



export function mapTestRunRecord(record: RpcStruct): KiwiTestRun {
  return {
    id: asNumber(record.id, "id"),
    summary: optionalString(record.summary) ?? optionalString(record.name) ?? "",
    build: optionalString(record.build__name) ?? optionalString(record.build) ?? "",
    planId: optionalNumber(record.plan) ?? optionalNumber(record.plan_id),
    planName: optionalString(record.plan__name) ?? optionalString(record.plan_name) ?? undefined,
    manager:
      optionalString(record.manager__username) ??
      optionalString(record.manager__name) ??
      optionalString(record.manager) ??
      undefined
  };
}



export function mapExecutionRecord(record: RpcStruct): KiwiCaseExecution {
  const runId = asNumber(record.run, "run");
  const caseId = asNumber(record.case, "case");
  return {
    id: asNumber(record.id, "id"),
    runId,
    runSummary: optionalString(record.run__summary) ?? optionalString(record.run__summary__name) ?? `Run ${runId}`,
    caseId,
    caseSummary: optionalString(record.case__summary) ?? `Case ${caseId}`,
    build: optionalString(record.build__name) ?? optionalString(record.build) ?? "",
    status: optionalString(record.status__name) ?? optionalString(record.status) ?? "",
    comment: optionalString(record.comment)
  };
}



export function mapTemplateRecord(record: RpcStruct): KiwiTemplate {
  return {
    id: asNumber(record.id, "id"),
    name: asString(record.name, "name"),
    text: optionalString(record.text) ?? ""
  };
}



export function mapCaseSearchRecord(
  record: RpcStruct,
  mode: KiwiCaseSearchMode,
  query: string
): KiwiCaseSearchResult {
  const text = optionalString(record.text) ?? "";
  return {
    caseId: asNumber(record.id, "id"),
    summary: optionalString(record.summary) ?? "",
    textSnippet: mode === "body" ? buildTextSnippet(text, query.toLocaleLowerCase()) : undefined
  };
}



function buildTextSnippet(text: string, normalizedQuery: string): string {
  const normalizedText = text.toLocaleLowerCase();
  const index = normalizedText.indexOf(normalizedQuery);
  if (index === -1) {
    return text.slice(0, 120);
  }
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + normalizedQuery.length + 80);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}



export function dedupeCaseSearchRecords(records: RpcStruct[]): RpcStruct[] {
  const byId = new Map<number, RpcStruct>();
  for (const record of records) {
    byId.set(asNumber(record.id, "id"), record);
  }
  return [...byId.values()];
}



export function compareHistoryDesc(left: KiwiCaseHistoryEntry, right: KiwiCaseHistoryEntry): number {
  const leftId = left.historyId ?? -1;
  const rightId = right.historyId ?? -1;
  if (leftId !== rightId) {
    return rightId - leftId;
  }

  return right.historyDate.localeCompare(left.historyDate);
}



export function mapAttachmentRecord(record: RpcStruct): KiwiCaseAttachment {
  const downloadUrl =
    optionalString(record.download_url) ??
    optionalString(record.url) ??
    optionalString(record.absolute_url);
  return {
    filename:
      optionalString(record.filename) ??
      optionalString(record.name) ??
      optionalString(record.file_name) ??
      filenameFromUrl(downloadUrl) ??
      "attachment",
    size:
      optionalNumber(record.size) ??
      optionalNumber(record.filesize) ??
      optionalNumber(record.file_size),
    downloadUrl
  };
}


function asNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new KiwiError("ApiUnsupported", `${field} must be a number.`);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown, field: string): string {
  if (typeof value === "string") {
    return value;
  }
  throw new KiwiError("ApiUnsupported", `${field} must be a string.`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
