import { KiwiAdapter } from "./types";
import {
  KiwiConfig,
  KiwiCase,
  KiwiCaseAttachment,
  KiwiCaseAttachmentContent,
  KiwiCaseBody,
  KiwiCaseExecution,
  KiwiCaseCreatePayload,
  KiwiCaseMetadataPatch,
  KiwiBuildOption,
  KiwiExecutionStatus,
  KiwiExecutionUpdatePatch,
  KiwiTestRun,
  KiwiTestRunCreatePayload
} from "../types";
import { KiwiError } from "../domain/errors";
import { loadMockState, saveMockState, MockState } from "./mockState";
import { filenameFromUrl } from "./realKiwiAdapter";

export class MockFileAdapter implements KiwiAdapter {
  constructor(private readonly statePath: string) {}

  async listPlans(config: KiwiConfig) {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    return [...state.plans];
  }

  async getPlan(config: KiwiConfig, planId: number) {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    if (state.failures?.notFoundPlanIds?.includes(planId)) {
      throw new KiwiError("NotFound", `Plan ${planId} was not found.`);
    }

    const plan = state.plans.find((item) => item.id === planId);
    if (!plan) {
      throw new KiwiError("NotFound", `Plan ${planId} was not found.`);
    }

    return { ...plan };
  }

  async listPlanCases(config: KiwiConfig, planId: number) {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    if (state.failures?.notFoundPlanIds?.includes(planId)) {
      throw new KiwiError("NotFound", `Plan ${planId} was not found.`);
    }

    const ids = state.planCases[String(planId)] ?? [];
    return ids
      .map((caseId) => state.cases[String(caseId)])
      .filter((item): item is KiwiCase => Boolean(item))
      .sort((left, right) => left.id - right.id)
      .map((item) => ({
        id: item.id,
        summary: item.summary
      }));
  }

  async getCase(config: KiwiConfig, caseId: number) {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    return copyCase(this.lookupCase(state, caseId));
  }

  async getCaseBody(config: KiwiConfig, caseId: number, planId: number): Promise<KiwiCaseBody> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    const item = this.lookupCase(state, caseId);
    return {
      id: item.id,
      planId,
      summary: item.summary,
      text: item.text
    };
  }

  async listCaseAttachments(config: KiwiConfig, caseId: number): Promise<KiwiCaseAttachment[]> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    this.lookupCase(state, caseId);
    return (state.attachments[String(caseId)] ?? []).map((item) => ({ ...item }));
  }

  async getCaseAttachmentContent(
    config: KiwiConfig,
    attachmentUrl: string
  ): Promise<KiwiCaseAttachmentContent> {
    const state = await this.authorize(config);
    this.ensureConnected(state);

    const attachment = Object.values(state.attachments)
      .flat()
      .find((item) => item.downloadUrl === attachmentUrl);
    if (!attachment) {
      throw new KiwiError("NotFound", `Attachment ${attachmentUrl} was not found.`);
    }

    return {
      filename:
        attachment.contentFilename ??
        attachment.filename ??
        filenameFromUrl(attachment.downloadUrl) ??
        filenameFromUrl(attachmentUrl),
      contentType: attachment.contentType,
      body: attachment.bodyBase64
        ? Buffer.from(attachment.bodyBase64, "base64")
        : Buffer.from("", "utf8")
    };
  }

  async addCaseAttachment(
    config: KiwiConfig,
    caseId: number,
    filename: string,
    _b64content: string
  ): Promise<void> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    this.lookupCase(state, caseId);
    if (state.failures?.validation) {
      throw new KiwiError("ValidationFailed", "Mock validation failure.");
    }

    const current = state.attachments[String(caseId)] ?? [];
    current.push({
      filename,
      size: Buffer.from(_b64content, "base64").byteLength,
      downloadUrl: `${config.baseUrl.replace(/\/$/, "")}/attachments/${caseId}/${encodeURIComponent(filename)}`,
      contentType: guessAttachmentContentType(filename),
      bodyBase64: _b64content
    });
    state.attachments[String(caseId)] = current;
    await saveMockState(this.statePath, state);
  }

  async getCaseHistory(config: KiwiConfig, caseId: number) {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    this.lookupCase(state, caseId);
    const history = state.histories[String(caseId)] ?? [];
    return history.map((item) => ({ ...item }));
  }

  async listCaseStatuses(config: KiwiConfig): Promise<string[]> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    return ["CONFIRMED", "IDLE", "DRAFT"];
  }

  async listPriorities(config: KiwiConfig): Promise<string[]> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    return ["P1", "P2", "P3"];
  }

  async listTestRuns(config: KiwiConfig): Promise<KiwiTestRun[]> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    return Object.values(state.testRuns ?? {})
      .sort((left, right) => left.id - right.id)
      .map((item) => ({ ...item }));
  }

  async listBuildsForPlan(config: KiwiConfig, planId: number): Promise<KiwiBuildOption[]> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    if (state.failures?.notFoundPlanIds?.includes(planId)) {
      throw new KiwiError("NotFound", `Plan ${planId} was not found.`);
    }
    const plan = state.plans.find((item) => item.id === planId);
    if (!plan) {
      throw new KiwiError("NotFound", `Plan ${planId} was not found.`);
    }

    const explicit = state.buildsByPlan?.[String(planId)] ?? [];
    if (explicit.length > 0) {
      return explicit.map((item) => ({ ...item }));
    }

    const inferred = Object.values(state.testRuns ?? {})
      .filter((item) => item.planId === planId && item.build.trim())
      .map((item) => item.build.trim());
    return [...new Set(inferred)].sort((left, right) => left.localeCompare(right)).map((name, index) => ({
      id: index + 1,
      name
    }));
  }

  async createTestRun(config: KiwiConfig, payload: KiwiTestRunCreatePayload): Promise<KiwiTestRun> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    if (state.failures?.validation) {
      throw new KiwiError("ValidationFailed", "Mock validation failure.");
    }
    const plan = state.plans.find((item) => item.id === payload.planId);
    if (!plan) {
      throw new KiwiError("NotFound", `Plan ${payload.planId} was not found.`);
    }
    const builds = await this.listBuildsForPlan(config, payload.planId);
    const selectedBuild = builds.find((item) => item.id === payload.buildId);
    if (!selectedBuild || !payload.manager.trim() || !payload.summary.trim()) {
      throw new KiwiError("ValidationFailed", "Test Run requires summary, plan, build, and manager.");
    }
    const nextRunId =
      Math.max(0, ...Object.keys(state.testRuns ?? {}).map((value) => Number.parseInt(value, 10) || 0)) + 1;
    const run: KiwiTestRun = {
      id: nextRunId,
      summary: payload.summary.trim(),
      build: selectedBuild.name,
      planId: plan.id,
      manager: payload.manager.trim()
    };
    state.testRuns ??= {};
    state.testRuns[String(nextRunId)] = { ...run };
    await saveMockState(this.statePath, state);
    return { ...run };
  }

  async listCaseExecutions(config: KiwiConfig, caseId: number): Promise<KiwiCaseExecution[]> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    this.lookupCase(state, caseId);
    return Object.values(state.executions ?? {})
      .filter((item) => item.caseId === caseId)
      .sort((left, right) => left.id - right.id)
      .map(copyExecution);
  }

  async listRunExecutions(config: KiwiConfig, runId: number): Promise<KiwiCaseExecution[]> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    if (!(state.testRuns?.[String(runId)])) {
      throw new KiwiError("NotFound", `Test Run ${runId} was not found.`);
    }
    return Object.values(state.executions ?? {})
      .filter((item) => item.runId === runId)
      .sort((left, right) => left.id - right.id)
      .map(copyExecution);
  }

  async addCaseToRun(config: KiwiConfig, runId: number, caseId: number): Promise<void> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    const run = state.testRuns?.[String(runId)];
    if (!run) {
      throw new KiwiError("NotFound", `Test Run ${runId} was not found.`);
    }
    const caseData = this.lookupCase(state, caseId);
    const exists = Object.values(state.executions ?? {}).some(
      (execution) => execution.runId === runId && execution.caseId === caseId
    );
    if (exists) {
      return;
    }
    const nextExecutionId =
      Math.max(0, ...Object.keys(state.executions ?? {}).map((value) => Number.parseInt(value, 10) || 0)) + 1;
    state.executions ??= {};
    state.executions[String(nextExecutionId)] = {
      id: nextExecutionId,
      runId,
      runSummary: run.summary,
      caseId: caseData.id,
      caseSummary: caseData.summary,
      build: run.build,
      status: "IDLE",
      comment: ""
    };
    await saveMockState(this.statePath, state);
  }

  async listExecutionStatuses(config: KiwiConfig): Promise<KiwiExecutionStatus[]> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    return (state.executionStatuses ?? defaultExecutionStatuses()).map((item) => ({ ...item }));
  }

  async updateExecution(
    config: KiwiConfig,
    executionId: number,
    patch: KiwiExecutionUpdatePatch
  ): Promise<KiwiCaseExecution> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    const existing = state.executions?.[String(executionId)];
    if (!existing) {
      throw new KiwiError("NotFound", `Execution ${executionId} was not found.`);
    }
    if (state.failures?.validation) {
      throw new KiwiError("ValidationFailed", "Mock validation failure.");
    }

    if (patch.status !== undefined) {
      const statuses = state.executionStatuses ?? defaultExecutionStatuses();
      if (!statuses.some((item) => item.name === patch.status)) {
        throw new KiwiError("ValidationFailed", `Execution status '${patch.status}' was not found.`);
      }
    }

    const updated: KiwiCaseExecution = {
      ...existing,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.comment !== undefined && patch.comment.trim() !== ""
        ? { comment: appendExecutionComment(existing.comment, patch.comment) }
        : {})
    };
    state.executions ??= {};
    state.executions[String(executionId)] = copyExecution(updated);
    await saveMockState(this.statePath, state);
    return copyExecution(updated);
  }

  async createCase(config: KiwiConfig, planId: number, payload: KiwiCaseCreatePayload): Promise<KiwiCase> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    if (state.failures?.notFoundPlanIds?.includes(planId)) {
      throw new KiwiError("NotFound", `Plan ${planId} was not found.`);
    }
    if (state.failures?.validation) {
      throw new KiwiError("ValidationFailed", "Mock validation failure.");
    }

    const nextCaseId =
      Math.max(0, ...Object.keys(state.cases).map((value) => Number.parseInt(value, 10) || 0)) + 1;
    const existingPlanCaseIds = state.planCases[String(planId)] ?? [];
    const category = resolveDefaultCategory(state, planId);
    const nextCase: KiwiCase = {
      id: nextCaseId,
      planId,
      summary: payload.summary,
      priority: payload.priority,
      category,
      status: payload.status,
      components: [],
      tags: normalizeTags(payload.tags),
      notes: "",
      text: payload.text
    };

    state.cases[String(nextCaseId)] = copyCase(nextCase);
    state.planCases[String(planId)] = [...existingPlanCaseIds, nextCaseId].sort((left, right) => left - right);
    state.histories[String(nextCaseId)] = [
      {
        historyId: 1,
        historyDate: new Date().toISOString(),
        historyChangeReason: "create"
      }
    ];

    await saveMockState(this.statePath, state);
    return copyCase(nextCase);
  }

  async addCaseToPlan(config: KiwiConfig, planId: number, caseId: number): Promise<void> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    if (state.failures?.notFoundPlanIds?.includes(planId)) {
      throw new KiwiError("NotFound", `Plan ${planId} was not found.`);
    }
    if (state.failures?.validation) {
      throw new KiwiError("ValidationFailed", "Mock validation failure.");
    }
    if (!state.plans.some((plan) => plan.id === planId)) {
      throw new KiwiError("NotFound", `Plan ${planId} was not found.`);
    }
    this.lookupCase(state, caseId);

    const current = state.planCases[String(planId)] ?? [];
    if (!current.includes(caseId)) {
      state.planCases[String(planId)] = [...current, caseId].sort((left, right) => left - right);
      await saveMockState(this.statePath, state);
    }
  }

  async removeCaseFromPlan(config: KiwiConfig, planId: number, caseId: number): Promise<void> {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    if (state.failures?.notFoundPlanIds?.includes(planId)) {
      throw new KiwiError("NotFound", `Plan ${planId} was not found.`);
    }
    if (state.failures?.validation) {
      throw new KiwiError("ValidationFailed", "Mock validation failure.");
    }
    if (!state.plans.some((plan) => plan.id === planId)) {
      throw new KiwiError("NotFound", `Plan ${planId} was not found.`);
    }
    this.lookupCase(state, caseId);

    const current = state.planCases[String(planId)] ?? [];
    if (current.includes(caseId)) {
      state.planCases[String(planId)] = current.filter((currentCaseId) => currentCaseId !== caseId);
      await saveMockState(this.statePath, state);
    }
  }

  async updateCaseText(config: KiwiConfig, caseId: number, text: string) {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    const existing = this.lookupCase(state, caseId);
    if (state.failures?.validation) {
      throw new KiwiError("ValidationFailed", "Mock validation failure.");
    }

    state.cases[String(caseId)] = {
      ...copyCase(existing),
      text
    };

    const previousHistory = state.histories[String(caseId)] ?? [];
    const nextHistoryId =
      previousHistory[0]?.historyId !== undefined ? previousHistory[0].historyId! + 1 : undefined;
    state.histories[String(caseId)] = [
      {
        historyId: nextHistoryId,
        historyDate: new Date().toISOString(),
        historyChangeReason: "update"
      },
      ...previousHistory
    ];

    await saveMockState(this.statePath, state);
    return copyCase(state.cases[String(caseId)]);
  }

  async updateCaseMetadata(config: KiwiConfig, caseId: number, patch: KiwiCaseMetadataPatch) {
    const state = await this.authorize(config);
    this.ensureConnected(state);
    const existing = this.lookupCase(state, caseId);
    if (state.failures?.validation) {
      throw new KiwiError("ValidationFailed", "Mock validation failure.");
    }

    state.cases[String(caseId)] = {
      ...copyCase(existing),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {})
    };

    const previousHistory = state.histories[String(caseId)] ?? [];
    const nextHistoryId =
      previousHistory[0]?.historyId !== undefined ? previousHistory[0].historyId! + 1 : undefined;
    state.histories[String(caseId)] = [
      {
        historyId: nextHistoryId,
        historyDate: new Date().toISOString(),
        historyChangeReason: "update-metadata"
      },
      ...previousHistory
    ];

    await saveMockState(this.statePath, state);
    return copyCase(state.cases[String(caseId)]);
  }

  private async authorize(config: KiwiConfig): Promise<MockState> {
    const state = await loadMockState(this.statePath);
    if (state.failures?.auth) {
      throw new KiwiError("AuthenticationFailed", "Mock authentication failure.");
    }
    if (state.failures?.authorization) {
      throw new KiwiError("AuthorizationFailed", "Mock authorization failure.");
    }
    if (
      config.username !== state.auth.username ||
      config.password !== state.auth.password
    ) {
      throw new KiwiError("AuthenticationFailed", "Credentials do not match mock state.");
    }

    return state;
  }

  private ensureConnected(state: MockState): void {
    if (state.failures?.connection) {
      throw new KiwiError("ConnectionFailed", "Mock connection failure.");
    }
  }

  private lookupCase(state: MockState, caseId: number): KiwiCase {
    if (state.failures?.notFoundCaseIds?.includes(caseId)) {
      throw new KiwiError("NotFound", `Case ${caseId} was not found.`);
    }

    const item = state.cases[String(caseId)];
    if (!item) {
      throw new KiwiError("NotFound", `Case ${caseId} was not found.`);
    }

    return item;
  }
}

function guessAttachmentContentType(filename: string): string {
  const normalized = filename.toLowerCase();
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown")) {
    return "text/markdown; charset=utf-8";
  }
  if (normalized.endsWith(".txt")) {
    return "text/plain; charset=utf-8";
  }
  if (normalized.endsWith(".json")) {
    return "application/json";
  }
  if (normalized.endsWith(".png")) {
    return "image/png";
  }
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".gif")) {
    return "image/gif";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalized.endsWith(".pdf")) {
    return "application/pdf";
  }
  return "application/octet-stream";
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

function defaultExecutionStatuses(): KiwiExecutionStatus[] {
  return [
    { id: 1, name: "IDLE" },
    { id: 2, name: "PASSED" },
    { id: 3, name: "FAILED" },
    { id: 4, name: "BLOCKED" }
  ];
}

function appendExecutionComment(current: string | undefined, next: string): string {
  const trimmed = next.trim();
  if (!current?.trim()) {
    return trimmed;
  }
  return `${current.trim()}\n\n${trimmed}`;
}

function normalizeTags(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function resolveDefaultCategory(state: MockState, planId: number): string {
  const planCaseIds = state.planCases[String(planId)] ?? [];
  for (const caseId of planCaseIds) {
    const existing = state.cases[String(caseId)];
    if (existing?.category) {
      return existing.category;
    }
  }
  return "Functional";
}
