import { KiwiAdapter } from "../types";
import {
  KiwiConfig,
  KiwiCase,
  KiwiCaseAttachment,
  KiwiCaseAttachmentContent,
  KiwiCaseBody,
  KiwiCaseExecution,
  KiwiCaseCreatePayload,
  KiwiCaseSearchMode,
  KiwiCaseSearchResult,
  KiwiBuildOption,
  KiwiCaseHistoryEntry,
  KiwiCaseHistoryVersion,
  KiwiCaseMetadataPatch,
  KiwiPlan,
  KiwiExecutionStatus,
  KiwiExecutionUpdatePatch,
  KiwiTestRun,
  KiwiTestRunCreatePayload,
  KiwiTemplate,
  PlanCaseRef
} from "../../types";
import { KiwiError } from "../../domain/errors";
import { createRpcSession, RpcSession, RpcSessionFactory, shouldInvalidateSession, toKiwiError } from "./session";
import { readAttachmentContent } from "./attachmentApi";
import { compareHistoryDesc, dedupeCaseSearchRecords, mapAttachmentRecord, mapCaseSearchRecord, mapExecutionRecord, mapPlanRecord, mapTemplateRecord, mapTestRunRecord } from "./mappers";
import { createCredentialCacheKey } from "./credentialCacheKey";

type RpcStruct = Record<string, unknown>;

type TagRecord = {
  id?: number;
  name: string;
};

type ComponentRecord = {
  id: number;
  name: string;
};

type PriorityRecord = {
  id?: number;
  value?: string;
};

type TestCaseStatusRecord = {
  id?: number;
  name?: string;
};

type TestExecutionStatusRecord = {
  id?: number;
  name?: string;
};

export class RealKiwiAdapter implements KiwiAdapter {
  private readonly sessionCache = new Map<string, RpcSession>();

  constructor(private readonly sessionFactory: RpcSessionFactory = createRpcSession) {}

  async listPlans(config: KiwiConfig): Promise<KiwiPlan[]> {
    return this.execute(config, async (session) => {
      const records = await callArray(session, "TestPlan.filter", [{}]);
      return records
        .map(mapPlanRecord)
        .sort((left, right) => left.id - right.id);
    });
  }

  async getPlan(config: KiwiConfig, planId: number): Promise<KiwiPlan> {
    return this.execute(config, async (session) => {
      const record = await this.findPlanRecordById(session, planId);
      return mapPlanRecord(record);
    });
  }

  async listPlanCases(config: KiwiConfig, planId: number): Promise<PlanCaseRef[]> {
    return this.execute(config, async (session) => {
      await this.findPlanRecordById(session, planId);
      const records = await callArray(session, "TestCase.filter", [{ plan: planId }]);
      return records
        .map((record) => ({
          id: asNumber(record.id, "id"),
          summary: asString(record.summary, "summary")
        }))
        .sort((left, right) => left.id - right.id);
    });
  }

  async getCase(config: KiwiConfig, caseId: number): Promise<KiwiCase> {
    return this.execute(config, async (session) => {
      return this.getCaseWithSession(session, caseId);
    });
  }

  async getCaseBody(config: KiwiConfig, caseId: number, planId: number): Promise<KiwiCaseBody> {
    return this.execute(config, async (session) => {
      const record = await this.findCaseRecordById(session, caseId);
      return {
        id: asNumber(record.id, "id"),
        planId,
        summary: asString(record.summary, "summary"),
        text: optionalString(record.text) ?? ""
      };
    });
  }

  async listCaseAttachments(config: KiwiConfig, caseId: number): Promise<KiwiCaseAttachment[]> {
    return this.execute(config, async (session) => {
      await this.findCaseRecordById(session, caseId);
      const records = await callArray(session, "TestCase.list_attachments", [caseId]);
      return records.map(mapAttachmentRecord).sort((left, right) =>
        left.filename.localeCompare(right.filename)
      );
    });
  }

  async getCaseAttachmentContent(
    config: KiwiConfig,
    attachmentUrl: string
  ): Promise<KiwiCaseAttachmentContent> {
    return readAttachmentContent(config, attachmentUrl);
  }

  async addCaseAttachment(
    config: KiwiConfig,
    caseId: number,
    filename: string,
    b64content: string
  ): Promise<void> {
    return this.execute(config, async (session) => {
      await this.findCaseRecordById(session, caseId);
      await session.call("TestCase.add_attachment", [caseId, filename, b64content]);
    });
  }

  async getCaseHistory(config: KiwiConfig, caseId: number): Promise<KiwiCaseHistoryEntry[]> {
    return this.execute(config, async (session) => {
      const records = await callArray(session, "TestCase.history", [caseId, {}]);
      if (records.length === 0) {
        throw new KiwiError("NotFound", `Case ${caseId} history was not found.`);
      }

      return records
        .map((record) => ({
          historyId: optionalNumber(record.history_id),
          historyDate: asIsoString(record.history_date, "history_date"),
          historyChangeReason: optionalString(record.history_change_reason),
          historyType: optionalString(record.history_type)
        }))
        .sort(compareHistoryDesc);
    });
  }

  async getCaseHistoryVersion(config: KiwiConfig, caseId: number, historyId: number): Promise<KiwiCaseHistoryVersion> {
    return this.execute(config, async (session) => {
      const records = await callArray(session, "TestCase.history", [caseId, { history_id: historyId }]);
      const record = records[0];
      if (!record) {
        throw new KiwiError("NotFound", `Case ${caseId} history ${historyId} was not found.`);
      }
      return {
        caseId,
        historyId: asNumber(record.history_id, "history_id"),
        historyDate: asIsoString(record.history_date, "history_date"),
        historyChangeReason: optionalString(record.history_change_reason),
        historyType: optionalString(record.history_type),
        summary: asString(record.summary, "summary"),
        text: optionalString(record.text) ?? ""
      };
    });
  }

  async listCaseStatuses(config: KiwiConfig): Promise<string[]> {
    return this.execute(config, async (session) => {
      const records = await callArray(session, "TestCaseStatus.filter", [{}]);
      return [...new Set(records.map((record) => asString(record.name, "name")))].sort((left, right) =>
        left.localeCompare(right)
      );
    });
  }

  async listPriorities(config: KiwiConfig): Promise<string[]> {
    return this.execute(config, async (session) => {
      const records = await callArray(session, "Priority.filter", [{}]);
      return [...new Set(records.map((record) => asString(record.value, "value")))].sort((left, right) =>
        left.localeCompare(right)
      );
    });
  }

  async listCaseTemplates(config: KiwiConfig): Promise<KiwiTemplate[]> {
    return this.execute(config, async (session) => {
      const records = await callArray(session, "Template.filter", [{}]);
      return records.map(mapTemplateRecord).sort((left, right) => left.name.localeCompare(right.name));
    });
  }

  async searchCases(
    config: KiwiConfig,
    input: { query: string; mode: KiwiCaseSearchMode }
  ): Promise<KiwiCaseSearchResult[]> {
    return this.execute(config, async (session) => {
      const query = input.query.trim();
      if (!query) {
        return [];
      }
      if (input.mode === "body") {
        const records = await callArray(session, "TestCase.filter", [{ text__icontains: query }]);
        return records
          .map((record) => mapCaseSearchRecord(record, input.mode, query))
          .sort((left, right) => left.caseId - right.caseId);
      }

      const records = await callArray(session, "TestCase.filter", [{ summary__icontains: query }]);
      if (/^\d+$/.test(query)) {
        records.push(...(await callArray(session, "TestCase.filter", [{ id: Number(query) }])));
      }
      return dedupeCaseSearchRecords(records)
        .map((record) => mapCaseSearchRecord(record, input.mode, query))
        .sort((left, right) => left.caseId - right.caseId);
    });
  }

  async listTestRuns(config: KiwiConfig): Promise<KiwiTestRun[]> {
    return this.execute(config, async (session) => {
      const records = await callArray(session, "TestRun.filter", [{}]);
      return records.map(mapTestRunRecord).sort((left, right) => left.id - right.id);
    });
  }

  async listRegisteredRunsForCase(config: KiwiConfig, caseId: number): Promise<KiwiTestRun[]> {
    return this.execute(config, async (session) => {
      await this.findCaseRecordById(session, caseId);
      const records = await callArray(session, "TestRun.filter", [{ executions__case: caseId }]);
      return records.map(mapTestRunRecord).sort((left, right) => left.id - right.id);
    });
  }

  async searchTestRuns(
    config: KiwiConfig,
    input: { query: string; planId?: number; build?: string }
  ): Promise<KiwiTestRun[]> {
    return this.execute(config, async (session) => {
      const query = input.query.trim();
      const filter: RpcStruct = {};
      if (input.planId !== undefined) {
        filter.plan = input.planId;
      }
      if (/^\d+$/.test(query)) {
        filter.id = Number(query);
      } else if (query) {
        filter.summary__icontains = query;
      }
      const records = await callArray(session, "TestRun.filter", [filter]);
      return records
        .map(mapTestRunRecord)
        .filter((run) => !input.build || run.build === input.build)
        .sort((left, right) => left.id - right.id);
    });
  }

  async listBuildsForPlan(config: KiwiConfig, planId: number): Promise<KiwiBuildOption[]> {
    return this.execute(config, async (session) => {
      const planRecord = await this.findPlanRecordById(session, planId);
      const productId = this.extractPlanProductId(planRecord);
      const records = await callArray(session, "Build.filter", [{ version__product: productId }]);
      return [
        ...new Set(
          records
            .map((record) => ({
              id: optionalNumber(record.id),
              name: (optionalString(record.name) ?? optionalString(record.value) ?? "").trim()
            }))
            .filter((record): record is { id: number; name: string } => record.id !== undefined && Boolean(record.name))
            .map((record) => `${record.id}\u0000${record.name}`)
        )
      ]
        .sort((left, right) => left.localeCompare(right))
        .map((value) => {
          const [id, name] = value.split("\u0000");
          return { id: Number(id), name };
        });
    });
  }

  async createTestRun(config: KiwiConfig, payload: KiwiTestRunCreatePayload): Promise<KiwiTestRun> {
    return this.execute(config, async (session) => {
      const created = asStruct(
        await session.call("TestRun.create", [
          {
            summary: payload.summary,
            plan: payload.planId,
            build: payload.buildId,
            manager: payload.manager
          }
        ]),
        "TestRun.create"
      );
      const runId = asNumber(created.id, "id");
      const record = await this.findRunRecordById(session, runId);
      return {
        id: runId,
        summary: optionalString(record.summary) ?? optionalString(record.name) ?? payload.summary,
        build: optionalString(record.build__name) ?? optionalString(record.build) ?? "",
        planId: optionalNumber(record.plan) ?? optionalNumber(record.plan_id) ?? payload.planId,
        manager:
          optionalString(record.manager__username) ??
          optionalString(record.manager__name) ??
          optionalString(record.manager) ??
          payload.manager
      };
    });
  }

  async listCaseExecutions(config: KiwiConfig, caseId: number): Promise<KiwiCaseExecution[]> {
    return this.execute(config, async (session) => {
      await this.findCaseRecordById(session, caseId);
      const [executionRecords, runRecords] = await Promise.all([
        callArray(session, "TestExecution.filter", [{ case: caseId }]),
        callArray(session, "TestRun.filter", [{ executions__case: caseId }])
      ]);
      const runSummaryById = new Map(
        runRecords.map((record) => [asNumber(record.id, "id"), optionalString(record.summary) ?? optionalString(record.name) ?? ""])
      );
      return executionRecords
        .map((record) => {
          const execution = mapExecutionRecord(record);
          return {
            ...execution,
            runSummary: runSummaryById.get(execution.runId) ?? execution.runSummary
          };
        })
        .sort((left, right) => left.id - right.id);
    });
  }

  async listRunExecutions(config: KiwiConfig, runId: number): Promise<KiwiCaseExecution[]> {
    return this.execute(config, async (session) => {
      const runRecord = await this.findRunRecordById(session, runId);
      const runSummary =
        optionalString(runRecord.summary) ?? optionalString(runRecord.name) ?? `Run ${runId}`;
      const records = await callArray(session, "TestExecution.filter", [{ run: runId }]);
      return records
        .map((record) => ({
          ...mapExecutionRecord(record),
          runSummary
        }))
        .sort((left, right) => left.id - right.id);
    });
  }

  async addCaseToRun(config: KiwiConfig, runId: number, caseId: number): Promise<void> {
    return this.execute(config, async (session) => {
      await this.findRunRecordById(session, runId);
      await this.findCaseRecordById(session, caseId);
      await session.call("TestRun.add_case", [runId, caseId]);
    });
  }

  async listExecutionStatuses(config: KiwiConfig): Promise<KiwiExecutionStatus[]> {
    return this.execute(config, async (session) => {
      const records = await callArray(session, "TestExecutionStatus.filter", [{}]);
      return records
        .map((record) => ({
          id: asNumber(record.id, "id"),
          name: asString(record.name, "name")
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    });
  }

  async updateExecution(
    config: KiwiConfig,
    executionId: number,
    patch: KiwiExecutionUpdatePatch
  ): Promise<KiwiCaseExecution> {
    return this.execute(config, async (session) => {
      const existing = await this.findExecutionRecordById(session, executionId);
      let updated = existing;
      if (patch.status !== undefined) {
        const statusId = await this.findExecutionStatusIdByName(session, patch.status);
        updated = asStruct(
          await session.call("TestExecution.update", [executionId, { status: statusId }]),
          "TestExecution.update"
        );
      }

      if (patch.comment !== undefined && patch.comment.trim() !== "") {
        await session.call("TestExecution.add_comment", [executionId, patch.comment.trim()]);
      }

      return {
        ...mapExecutionRecord(updated),
        ...(patch.comment !== undefined && patch.comment.trim() !== "" ? { comment: patch.comment.trim() } : {})
      };
    });
  }

  async createCase(
    config: KiwiConfig,
    planId: number,
    payload: KiwiCaseCreatePayload
  ): Promise<KiwiCase> {
    return this.execute(config, async (session) => {
      const planRecord = await this.findPlanRecordById(session, planId);
      const productId = this.extractPlanProductId(planRecord);
      const categoryId = await this.findDefaultCategoryIdForPlan(session, planId, productId);
      const priorityId = await this.findPriorityIdByValue(session, payload.priority);
      const statusId = await this.findCaseStatusIdByName(session, payload.status);

      const created = asStruct(
        await session.call("TestCase.create", [
          {
            category: categoryId,
            product: productId,
            summary: payload.summary,
            priority: priorityId,
            case_status: statusId
          }
        ]),
        "TestCase.create"
      );
      const caseId = asNumber(created.id, "id");

      await session.call("TestPlan.add_case", [planId, caseId]);

      if (payload.text) {
        await session.call("TestCase.update", [caseId, { text: payload.text }]);
      }

      if (payload.tags.length > 0) {
        await this.updateCaseMetadata(config, caseId, {
          ...(payload.tags.length > 0 ? { tags: payload.tags } : {})
        });
      }

      return this.getCaseWithSession(session, caseId);
    });
  }

  async addCaseToPlan(config: KiwiConfig, planId: number, caseId: number): Promise<void> {
    return this.execute(config, async (session) => {
      await this.findPlanRecordById(session, planId);
      await this.findCaseRecordById(session, caseId);
      await session.call("TestPlan.add_case", [planId, caseId]);
    });
  }

  async removeCaseFromPlan(config: KiwiConfig, planId: number, caseId: number): Promise<void> {
    return this.execute(config, async (session) => {
      await this.findPlanRecordById(session, planId);
      await this.findCaseRecordById(session, caseId);
      await session.call("TestPlan.remove_case", [planId, caseId]);
    });
  }

  async deleteCase(config: KiwiConfig, caseId: number): Promise<void> {
    return this.execute(config, async (session) => {
      await this.findCaseRecordById(session, caseId);
      await session.call("TestCase.remove", [{ pk: caseId }]);
    });
  }

  async updateCaseText(config: KiwiConfig, caseId: number, text: string): Promise<KiwiCase> {
    return this.execute(config, async (session) => {
      await session.call("TestCase.update", [
        caseId,
        {
          text
        }
      ]);

      return this.getCaseWithSession(session, caseId);
    });
  }

  async updateCaseMetadata(
    config: KiwiConfig,
    caseId: number,
    patch: KiwiCaseMetadataPatch
  ): Promise<KiwiCase> {
    return this.execute(config, async (session) => {
      await this.findCaseRecordById(session, caseId);

      const values: RpcStruct = {};
      if (patch.summary !== undefined) {
        values.summary = patch.summary;
      }
      if (patch.priority !== undefined) {
        values.priority = await this.findPriorityIdByValue(session, patch.priority);
      }
      if (patch.status !== undefined) {
        values.case_status = await this.findCaseStatusIdByName(session, patch.status);
      }

      if (Object.keys(values).length > 0) {
        await session.call("TestCase.update", [caseId, values]);
      }

      if (patch.tags !== undefined) {
        const currentTags = await this.listCaseTags(session, caseId);
        const currentNames = new Set(currentTags.map((item) => item.name));
        const requestedNames = new Set(normalizeTagNames(patch.tags));

        for (const currentName of currentNames) {
          if (!requestedNames.has(currentName)) {
            await session.call("TestCase.remove_tag", [caseId, currentName]);
          }
        }
        for (const requestedName of requestedNames) {
          if (!currentNames.has(requestedName)) {
            await session.call("TestCase.add_tag", [caseId, requestedName]);
          }
        }
      }

      return this.getCaseWithSession(session, caseId);
    });
  }

  private async getCaseWithSession(session: RpcSession, caseId: number): Promise<KiwiCase> {
    const record = await this.findCaseRecordById(session, caseId);
    const planRecord = await this.findPlanRecordByCaseId(session, caseId);
    const tags = await this.listCaseTags(session, caseId);
    const components = await this.listCaseComponents(session, caseId);
    return {
      id: asNumber(record.id, "id"),
      planId: asNumber(planRecord.id, "id"),
      summary: asString(record.summary, "summary"),
      priority: optionalString(record.priority__value) ?? "",
      category: optionalString(record.category__name) ?? "",
      status: optionalString(record.case_status__name) ?? "",
      components: components.map((item) => item.name),
      tags: tags.map((item) => item.name),
      notes: optionalString(record.notes) ?? "",
      text: optionalString(record.text) ?? ""
    };
  }

  private async findPlanRecordById(session: RpcSession, planId: number): Promise<RpcStruct> {
    const records = await callArray(session, "TestPlan.filter", [{ id: planId }]);
    const record = records[0];
    if (!record) {
      throw new KiwiError("NotFound", `Plan ${planId} was not found.`);
    }

    return record;
  }

  private async findPlanRecordByCaseId(session: RpcSession, caseId: number): Promise<RpcStruct> {
    const records = await callArray(session, "TestPlan.filter", [{ cases: caseId }]);
    const record = records[0];
    if (!record) {
      throw new KiwiError("NotFound", `Plan for case ${caseId} was not found.`);
    }

    return record;
  }

  private async findCaseRecordById(session: RpcSession, caseId: number): Promise<RpcStruct> {
    const records = await callArray(session, "TestCase.filter", [{ id: caseId }]);
    const record = records[0];
    if (!record) {
      throw new KiwiError("NotFound", `Case ${caseId} was not found.`);
    }

    return record;
  }

  private async findExecutionRecordById(session: RpcSession, executionId: number): Promise<RpcStruct> {
    const records = await callArray(session, "TestExecution.filter", [{ id: executionId }]);
    const record = records[0];
    if (!record) {
      throw new KiwiError("NotFound", `Execution ${executionId} was not found.`);
    }

    return record;
  }

  private async findRunRecordById(session: RpcSession, runId: number): Promise<RpcStruct> {
    const records = await callArray(session, "TestRun.filter", [{ id: runId }]);
    const record = records[0];
    if (!record) {
      throw new KiwiError("NotFound", `Test Run ${runId} was not found.`);
    }
    return record;
  }

  private async listCaseTags(session: RpcSession, caseId: number): Promise<TagRecord[]> {
    const records = await callArray(session, "Tag.filter", [{ case: caseId }]);
    return records
      .map((record) => ({
        id: optionalNumber(record.id),
        name: asString(record.name, "name")
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private async listCaseComponents(session: RpcSession, caseId: number): Promise<ComponentRecord[]> {
    const records = await callArray(session, "Component.filter", [{ cases: caseId }]);
    return records
      .map((record) => ({
        id: asNumber(record.id, "id"),
        name: asString(record.name, "name")
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private async findPriorityIdByValue(session: RpcSession, value: string): Promise<number> {
    const records = await callArray(session, "Priority.filter", [{ value }]);
    const record = records[0] as PriorityRecord | undefined;
    if (!record?.id) {
      throw new KiwiError("ValidationFailed", `Priority '${value}' was not found.`);
    }
    return record.id;
  }

  private async findCaseStatusIdByName(session: RpcSession, name: string): Promise<number> {
    const records = await callArray(session, "TestCaseStatus.filter", [{ name }]);
    const record = records[0] as TestCaseStatusRecord | undefined;
    if (!record?.id) {
      throw new KiwiError("ValidationFailed", `Status '${name}' was not found.`);
    }
    return record.id;
  }

  private async findExecutionStatusIdByName(session: RpcSession, name: string): Promise<number> {
    const records = await callArray(session, "TestExecutionStatus.filter", [{ name }]);
    const record = records[0] as TestExecutionStatusRecord | undefined;
    if (!record?.id) {
      throw new KiwiError("ValidationFailed", `Execution status '${name}' was not found.`);
    }
    return record.id;
  }

  private extractPlanProductId(record: RpcStruct): number {
    const candidates = ["product", "product_id", "product__id"] as const;
    for (const field of candidates) {
      const value = optionalNumber(record[field]);
      if (value !== undefined) {
        return value;
      }
    }
    throw new KiwiError("ValidationFailed", "Plan product could not be resolved.");
  }

  private async findDefaultCategoryIdForPlan(
    session: RpcSession,
    planId: number,
    productId: number
  ): Promise<number> {
    const planCaseRecords = await callArray(session, "TestCase.filter", [{ plan: planId }]);
    for (const record of planCaseRecords) {
      const categoryId = optionalNumber(record.category) ?? optionalNumber(record.category_id);
      if (categoryId !== undefined) {
        return categoryId;
      }
    }

    const categoryRecords = await callArray(session, "Category.filter", [{ product: productId }]);
    const firstCategory = categoryRecords
      .map((record) => ({
        id: optionalNumber(record.id),
        name: optionalString(record.name) ?? ""
      }))
      .filter((record): record is { id: number; name: string } => record.id !== undefined)
      .sort((left, right) => {
        const byName = left.name.localeCompare(right.name);
        return byName !== 0 ? byName : left.id - right.id;
      })[0];
    if (!firstCategory) {
      throw new KiwiError("ValidationFailed", "Default category could not be resolved.");
    }
    return firstCategory.id;
  }

  private async execute<T>(
    config: KiwiConfig,
    operation: (session: RpcSession) => Promise<T>
  ): Promise<T> {
    const session = this.getSession(config);
    try {
      return await operation(session);
    } catch (error) {
      const kiwiError = toKiwiError(error);
      if (shouldInvalidateSession(kiwiError)) {
        this.sessionCache.delete(this.sessionKey(config));
      }
      throw kiwiError;
    }
  }

  private getSession(config: KiwiConfig): RpcSession {
    const key = this.sessionKey(config);
    const cached = this.sessionCache.get(key);
    if (cached) {
      return cached;
    }

    const session = this.sessionFactory(config);
    this.sessionCache.set(key, session);
    return session;
  }

  private sessionKey(config: KiwiConfig): string {
    return createCredentialCacheKey(config);
  }
}

function normalizeTagNames(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

async function callArray(
  session: RpcSession,
  method: string,
  params: unknown[]
): Promise<RpcStruct[]> {
  const value = await session.call(method, params);
  if (!Array.isArray(value)) {
    throw new KiwiError("ApiUnsupported", `${method} returned a non-array payload.`);
  }

  return value.map((item) => asStruct(item, method));
}

function asStruct(value: unknown, field: string): RpcStruct {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KiwiError("ApiUnsupported", `${field} returned an invalid struct.`);
  }

  return value as RpcStruct;
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

function asIsoString(value: unknown, field: string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  throw new KiwiError("ApiUnsupported", `${field} must be a date.`);
}
