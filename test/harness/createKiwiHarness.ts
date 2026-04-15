import { mkdtemp } from "node:fs/promises";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  KiwiBuildOption,
  KiwiCase,
  KiwiCaseExecution,
  KiwiCaseHistoryEntry,
  KiwiExecutionStatus,
  KiwiTestRun,
  KiwiPlan,
  KiwiTemplate
} from "../../src/types";
import {
  MockCaseAttachmentRecord,
  MockState,
  saveMockState,
  loadMockState
} from "../../src/adapter/mockState";

export interface KiwiHarness {
  baseUrl: string;
  statePath: string;
  seedPlans(plans: KiwiPlan[]): Promise<void>;
  seedPlanCases(planId: number, caseIds: number[]): Promise<void>;
  seedCaseDocument(value: KiwiCase): Promise<void>;
  seedCaseHistory(caseId: number, history: KiwiCaseHistoryEntry[]): Promise<void>;
  seedCaseTemplates(templates: KiwiTemplate[]): Promise<void>;
  seedCaseAttachments(caseId: number, attachments: MockCaseAttachmentRecord[]): Promise<void>;
  seedBuildsForPlan(planId: number, builds: KiwiBuildOption[]): Promise<void>;
  seedTestRuns(testRuns: KiwiTestRun[]): Promise<void>;
  seedExecutions(executions: KiwiCaseExecution[]): Promise<void>;
  seedExecutionStatuses(statuses: KiwiExecutionStatus[]): Promise<void>;
  simulateRemoteChange(caseId: number, updater: (current: KiwiCase) => KiwiCase): Promise<void>;
  setFailureMode(mode: keyof NonNullable<MockState["failures"]>, value: boolean | number[]): Promise<void>;
  collectLogs(filePath: string): Promise<unknown[]>;
  readState(): Promise<MockState>;
}

export async function createKiwiHarness(): Promise<KiwiHarness> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kiwifs-"));
  const statePath = path.join(directory, "mock-state.json");
  const initial: MockState = {
    auth: {
      username: "admin",
      password: "admin"
    },
    plans: [],
    planCases: {},
    cases: {},
    attachments: {},
    histories: {},
    templates: [],
    buildsByPlan: {},
    testRuns: {},
    executions: {},
    executionStatuses: [
      { id: 1, name: "IDLE" },
      { id: 2, name: "PASSED" },
      { id: 3, name: "FAILED" },
      { id: 4, name: "BLOCKED" }
    ],
    failures: {}
  };
  await saveMockState(statePath, initial);

  return {
    baseUrl: "mock://default",
    statePath,
    async seedPlans(plans) {
      const state = await loadMockState(statePath);
      state.plans = plans.map((item) => ({ ...item }));
      await saveMockState(statePath, state);
    },
    async seedPlanCases(planId, caseIds) {
      const state = await loadMockState(statePath);
      state.planCases[String(planId)] = [...caseIds];
      await saveMockState(statePath, state);
    },
    async seedCaseDocument(value) {
      const state = await loadMockState(statePath);
      state.cases[String(value.id)] = copyCase(value);
      await saveMockState(statePath, state);
    },
    async seedCaseHistory(caseId, history) {
      const state = await loadMockState(statePath);
      state.histories[String(caseId)] = history.map((item) => ({ ...item }));
      await saveMockState(statePath, state);
    },
    async seedCaseTemplates(templates) {
      const state = await loadMockState(statePath);
      state.templates = templates.map((item) => ({ ...item }));
      await saveMockState(statePath, state);
    },
    async seedCaseAttachments(caseId, attachments) {
      const state = await loadMockState(statePath);
      state.attachments[String(caseId)] = attachments.map((item) => ({ ...item }));
      await saveMockState(statePath, state);
    },
    async seedBuildsForPlan(planId, builds) {
      const state = await loadMockState(statePath);
      state.buildsByPlan ??= {};
      state.buildsByPlan[String(planId)] = builds.map((item) => ({ ...item }));
      await saveMockState(statePath, state);
    },
    async seedTestRuns(testRuns) {
      const state = await loadMockState(statePath);
      state.testRuns = Object.fromEntries(testRuns.map((item) => [String(item.id), { ...item }]));
      await saveMockState(statePath, state);
    },
    async seedExecutions(executions) {
      const state = await loadMockState(statePath);
      state.executions = Object.fromEntries(executions.map((item) => [String(item.id), copyExecution(item)]));
      await saveMockState(statePath, state);
    },
    async seedExecutionStatuses(statuses) {
      const state = await loadMockState(statePath);
      state.executionStatuses = statuses.map((item) => ({ ...item }));
      await saveMockState(statePath, state);
    },
    async simulateRemoteChange(caseId, updater) {
      const state = await loadMockState(statePath);
      const current = state.cases[String(caseId)];
      if (!current) {
        throw new Error(`Case ${caseId} was not found.`);
      }
      state.cases[String(caseId)] = copyCase(updater(copyCase(current)));
      const previousHistory = state.histories[String(caseId)] ?? [];
      const nextHistoryId =
        previousHistory[0]?.historyId !== undefined ? previousHistory[0].historyId! + 1 : undefined;
      state.histories[String(caseId)] = [
        {
          historyId: nextHistoryId,
          historyDate: new Date().toISOString(),
          historyChangeReason: "remote-change"
        },
        ...previousHistory
      ];
      await saveMockState(statePath, state);
    },
    async setFailureMode(mode, value) {
      const state = await loadMockState(statePath);
      state.failures ??= {};
      if (mode === "notFoundPlanIds" || mode === "notFoundCaseIds") {
        state.failures[mode] = Array.isArray(value) ? value : [];
      } else {
        state.failures[mode] = Boolean(value);
      }
      await saveMockState(statePath, state);
    },
    async collectLogs(filePath) {
      const content = await readFile(filePath, "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    async readState() {
      return loadMockState(statePath);
    }
  };
}

function copyCase(value: KiwiCase): KiwiCase {
  return {
    ...value,
    components: [...value.components],
    tags: [...value.tags]
  };
}

function copyExecution(value: KiwiCaseExecution): KiwiCaseExecution {
  return { ...value };
}
