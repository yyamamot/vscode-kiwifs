import { readFile, writeFile } from "node:fs/promises";
import {
  KiwiBuildOption,
  KiwiCase,
  KiwiCaseAttachment,
  KiwiCaseExecution,
  KiwiCaseHistoryEntry,
  KiwiExecutionStatus,
  KiwiTestRun,
  KiwiPlan,
  KiwiTemplate
} from "../types";

export interface MockCaseAttachmentRecord extends KiwiCaseAttachment {
  contentType?: string;
  bodyBase64?: string;
  contentFilename?: string;
}

export interface MockFailureModes {
  auth?: boolean;
  authorization?: boolean;
  notFoundPlanIds?: number[];
  notFoundCaseIds?: number[];
  validation?: boolean;
  connection?: boolean;
  templates?: boolean;
}

export interface MockAuthConfig {
  username: string;
  password: string;
}

export interface MockState {
  auth: MockAuthConfig;
  plans: KiwiPlan[];
  planCases: Record<string, number[]>;
  cases: Record<string, KiwiCase>;
  attachments: Record<string, MockCaseAttachmentRecord[]>;
  histories: Record<string, KiwiCaseHistoryEntry[]>;
  templates?: KiwiTemplate[];
  buildsByPlan?: Record<string, KiwiBuildOption[]>;
  testRuns?: Record<string, KiwiTestRun>;
  executions?: Record<string, KiwiCaseExecution>;
  executionStatuses?: KiwiExecutionStatus[];
  failures?: MockFailureModes;
}

export async function loadMockState(filePath: string): Promise<MockState> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as MockState;
}

export async function saveMockState(filePath: string, state: MockState): Promise<void> {
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}
