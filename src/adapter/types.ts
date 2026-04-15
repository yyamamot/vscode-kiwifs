import {
  KiwiCase,
  KiwiCaseAttachment,
  KiwiCaseAttachmentContent,
  KiwiCaseBody,
  KiwiCaseCreatePayload,
  KiwiCaseHistoryEntry,
  KiwiCaseHistoryVersion,
  KiwiCaseMetadataPatch,
  KiwiCaseSearchMode,
  KiwiCaseSearchResult,
  KiwiConfig,
  KiwiCaseExecution,
  KiwiBuildOption,
  KiwiExecutionStatus,
  KiwiExecutionUpdatePatch,
  KiwiPlan,
  KiwiTemplate,
  KiwiTestRun,
  KiwiTestRunCreatePayload,
  PlanCaseRef
} from "../types";

export interface KiwiAdapter {
  listPlans(config: KiwiConfig): Promise<KiwiPlan[]>;
  getPlan(config: KiwiConfig, planId: number): Promise<KiwiPlan>;
  listPlanCases(config: KiwiConfig, planId: number): Promise<PlanCaseRef[]>;
  getCaseBody(config: KiwiConfig, caseId: number, planId: number): Promise<KiwiCaseBody>;
  getCase(config: KiwiConfig, caseId: number, planId?: number): Promise<KiwiCase>;
  listCaseAttachments(config: KiwiConfig, caseId: number): Promise<KiwiCaseAttachment[]>;
  getCaseAttachmentContent(
    config: KiwiConfig,
    attachmentUrl: string
  ): Promise<KiwiCaseAttachmentContent>;
  addCaseAttachment(
    config: KiwiConfig,
    caseId: number,
    filename: string,
    b64content: string
  ): Promise<void>;
  getCaseHistory(config: KiwiConfig, caseId: number): Promise<KiwiCaseHistoryEntry[]>;
  getCaseHistoryVersion(config: KiwiConfig, caseId: number, historyId: number): Promise<KiwiCaseHistoryVersion>;
  listCaseStatuses(config: KiwiConfig): Promise<string[]>;
  listPriorities(config: KiwiConfig): Promise<string[]>;
  listCaseTemplates(config: KiwiConfig): Promise<KiwiTemplate[]>;
  searchCases(
    config: KiwiConfig,
    input: { query: string; mode: KiwiCaseSearchMode }
  ): Promise<KiwiCaseSearchResult[]>;
  listTestRuns(config: KiwiConfig): Promise<KiwiTestRun[]>;
  listRegisteredRunsForCase(config: KiwiConfig, caseId: number): Promise<KiwiTestRun[]>;
  searchTestRuns(config: KiwiConfig, input: { query: string; planId?: number; build?: string }): Promise<KiwiTestRun[]>;
  listBuildsForPlan(config: KiwiConfig, planId: number): Promise<KiwiBuildOption[]>;
  createTestRun(config: KiwiConfig, payload: KiwiTestRunCreatePayload): Promise<KiwiTestRun>;
  listCaseExecutions(config: KiwiConfig, caseId: number): Promise<KiwiCaseExecution[]>;
  listRunExecutions(config: KiwiConfig, runId: number): Promise<KiwiCaseExecution[]>;
  addCaseToRun(config: KiwiConfig, runId: number, caseId: number): Promise<void>;
  listExecutionStatuses(config: KiwiConfig): Promise<KiwiExecutionStatus[]>;
  updateExecution(
    config: KiwiConfig,
    executionId: number,
    patch: KiwiExecutionUpdatePatch
  ): Promise<KiwiCaseExecution>;
  createCase(config: KiwiConfig, planId: number, payload: KiwiCaseCreatePayload): Promise<KiwiCase>;
  addCaseToPlan(config: KiwiConfig, planId: number, caseId: number): Promise<void>;
  removeCaseFromPlan(config: KiwiConfig, planId: number, caseId: number): Promise<void>;
  deleteCase(config: KiwiConfig, caseId: number): Promise<void>;
  updateCaseText(config: KiwiConfig, caseId: number, text: string): Promise<KiwiCase>;
  updateCaseMetadata(
    config: KiwiConfig,
    caseId: number,
    patch: KiwiCaseMetadataPatch
  ): Promise<KiwiCase>;
}
