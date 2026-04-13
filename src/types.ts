export interface KiwiPlan {
  id: number;
  name: string;
  text?: string;
}

export interface KiwiCase {
  id: number;
  planId: number;
  summary: string;
  priority: string;
  category: string;
  status: string;
  components: string[];
  tags: string[];
  notes: string;
  text: string;
}

export interface KiwiCaseMetadataPatch {
  summary?: string;
  priority?: string;
  status?: string;
  tags?: string[];
}

export interface KiwiCaseCreatePayload {
  summary: string;
  priority: string;
  status: string;
  tags: string[];
  text: string;
}

export interface KiwiExecutionStatus {
  id: number;
  name: string;
}

export interface KiwiTestRun {
  id: number;
  summary: string;
  build: string;
  planId?: number;
  planName?: string;
  manager?: string;
}

export interface KiwiTestRunCreatePayload {
  summary: string;
  planId: number;
  buildId: number;
  manager: string;
}

export interface KiwiBuildOption {
  id: number;
  name: string;
}

export interface KiwiCaseExecution {
  id: number;
  runId: number;
  runSummary: string;
  caseId: number;
  caseSummary: string;
  build: string;
  status: string;
  comment?: string;
}

export interface KiwiExecutionUpdatePatch {
  status?: string;
  comment?: string;
}

export interface KiwiCaseBody {
  id: number;
  planId: number;
  summary: string;
  text: string;
}

export interface KiwiCaseHistoryEntry {
  historyId?: number;
  historyDate: string;
  historyChangeReason?: string;
  historyType?: string;
  text?: string;
}

export interface KiwiCaseHistoryVersion {
  caseId: number;
  historyId: number;
  historyDate: string;
  historyChangeReason?: string;
  historyType?: string;
  summary: string;
  text: string;
}

export interface KiwiCaseAttachment {
  filename: string;
  size?: number;
  downloadUrl?: string;
}

export interface KiwiCaseAttachmentContent {
  filename?: string;
  contentType?: string;
  body: Uint8Array;
}

export interface KiwiConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export interface CaseDocumentData {
  body: string;
}

export interface CaseDocumentSessionMetadata {
  caseId: number;
  planId: number;
  versionToken: string;
}

export interface CaseDocumentCacheEntry extends CaseDocumentSessionMetadata {
  body: string;
  size: number;
  mtime: number;
}

export interface StructuredLogEvent {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  source:
    | "provider"
    | "adapter"
    | "documentCodec"
    | "listingStrategy"
    | "runtime"
    | "mockServer"
    | "harness"
    | "integrationHost";
  runId: string;
  operation: string;
  entityType: string;
  entityId: string;
  virtualPath: string;
  outcome: "started" | "succeeded" | "failed";
  errorCode?: string;
  message?: string;
  details?: string;
}

export interface PlanCaseRef {
  id: number;
  summary: string;
}
