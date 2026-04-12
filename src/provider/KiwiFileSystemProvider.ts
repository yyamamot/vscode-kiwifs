import * as vscode from "vscode";
import { Buffer } from "node:buffer";
import { KiwiAdapter } from "../adapter/types";
import {
  CaseDocumentCacheEntry,
  CaseDocumentSessionMetadata,
  KiwiConfig,
  KiwiPlan,
  PlanCaseRef
} from "../types";
import { planDirectoryName, caseFileName, parseNumericPrefix } from "../domain/pathCodec";
import { parseCaseDocument, renderCaseDocument, toCaseDocumentData } from "../domain/documentCodec";
import { deriveVersionToken } from "../domain/versionToken";
import { JsonlLogger } from "../logging/jsonlLogger";
import { KiwiError } from "../domain/errors";

export class KiwiFileSystemProvider implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly planListCache = new Map<string, [string, vscode.FileType][]>();
  private readonly caseListCache = new Map<string, [string, vscode.FileType][]>();
  private readonly planCache = new Map<number, KiwiPlan>();
  private readonly planDirCache = new Map<string, number>();
  private readonly caseCache = new Map<number, PlanCaseRef & { planId: number }>();
  private readonly caseFileCache = new Map<string, { planId: number; caseId: number }>();
  private readonly caseSessionCache = new Map<string, CaseDocumentSessionMetadata>();
  private readonly caseContentCache = new Map<string, CaseDocumentCacheEntry>();
  private readonly inFlightCaseReads = new Map<string, Promise<Uint8Array>>();
  private readonly statCache = new Map<string, { type: vscode.FileType; ctime: number; mtime: number; size: number }>();

  constructor(
    private readonly clientFactory: () => Promise<{
      adapter: KiwiAdapter;
      config: KiwiConfig;
    }>,
    private readonly logger: JsonlLogger
  ) {}

  readonly onDidChangeFile = this.emitter.event;

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const cached = this.statCache.get(uri.toString());
    if (cached) {
      return cached;
    }

    const node = await this.resolveNode(uri);
    const stat = {
      type: node.type,
      ctime: 0,
      mtime: 0,
      size: node.size ?? 0
    };
    this.statCache.set(uri.toString(), stat);
    return stat;
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    try {
      const parts = splitPath(uri);
      if (parts.length === 1 && parts[0] === "plans") {
        const cached = this.planListCache.get(uri.toString());
        if (cached) {
          return cached;
        }
        logInBackground(this.logger, {
          level: "info",
          event: "plan.list.started",
          source: "provider",
          operation: "readDirectory",
          entityType: "directory",
          entityId: uri.path,
          virtualPath: uri.toString(),
          outcome: "started"
        });
        const { adapter, config } = await this.clientFactory();
        const plans = await adapter.listPlans(config);
        const entries = plans.map<[string, vscode.FileType]>((plan) => {
          this.planCache.set(plan.id, plan);
          const dir = planDirectoryName(plan);
          this.planDirCache.set(dir, plan.id);
          this.setStatCache(
            vscode.Uri.parse(`kiwi:/plans/${dir}`),
            vscode.FileType.Directory,
            0
          );
          return [dir, vscode.FileType.Directory];
        });
        this.planListCache.set(uri.toString(), entries);
        this.setStatCache(uri, vscode.FileType.Directory, 0);

        logInBackground(this.logger, {
          level: "info",
          event: "plan.list.succeeded",
          source: "provider",
          operation: "readDirectory",
          entityType: "directory",
          entityId: "plans",
          virtualPath: uri.toString(),
          outcome: "succeeded"
        });
        return entries;
      }

      if (parts.length === 3 && parts[0] === "plans" && parts[2] === "cases") {
        const cached = this.caseListCache.get(uri.toString());
        if (cached) {
          return cached;
        }
        logInBackground(this.logger, {
          level: "info",
          event: "case.list.started",
          source: "provider",
          operation: "readDirectory",
          entityType: "directory",
          entityId: uri.path,
          virtualPath: uri.toString(),
          outcome: "started"
        });
        const planId = await this.resolvePlanId(parts[1]);
        const { adapter, config } = await this.clientFactory();
        const cases = await adapter.listPlanCases(config, planId);
        const entries = cases.map<[string, vscode.FileType]>((item) => {
          this.caseCache.set(item.id, { ...item, planId });
          const file = caseFileName(item);
          this.caseFileCache.set(`${planId}:${file}`, { planId, caseId: item.id });
          this.setStatCache(
            vscode.Uri.parse(`kiwi:/plans/${parts[1]}/cases/${file}`),
            vscode.FileType.File,
            0
          );
          return [file, vscode.FileType.File];
        });
        this.caseListCache.set(uri.toString(), entries);
        this.setStatCache(uri, vscode.FileType.Directory, 0);

        logInBackground(this.logger, {
          level: "info",
          event: "case.list.succeeded",
          source: "provider",
          operation: "readDirectory",
          entityType: "directory",
          entityId: String(planId),
          virtualPath: uri.toString(),
          outcome: "succeeded"
        });
        return entries;
      }

      throw vscode.FileSystemError.FileNotFound(uri);
    } catch (error) {
      await this.logger.log({
        level: "error",
        event: uri.path.includes("/cases") ? "case.list.failed" : "plan.list.failed",
        source: "provider",
        operation: "readDirectory",
        entityType: "directory",
        entityId: uri.path,
        virtualPath: uri.toString(),
        outcome: "failed",
        errorCode: normalizeErrorCode(error),
        message: error instanceof Error ? error.message : String(error)
      });
      throw asFsError(error, uri);
    }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      const parts = splitPath(uri);
      if (parts.length === 3 && parts[0] === "plans" && parts[2] === "plan.json") {
        const planId = await this.resolvePlanId(parts[1]);
        const { adapter, config } = await this.clientFactory();
        const plan = await adapter.getPlan(config, planId);
        const content = Buffer.from(JSON.stringify(plan, null, 2), "utf8");
        this.setStatCache(uri, vscode.FileType.File, content.byteLength);
        return content;
      }

      if (parts.length === 4 && parts[0] === "plans" && parts[2] === "cases") {
        const cached = this.caseContentCache.get(uri.toString());
        if (cached) {
          return Buffer.from(cached.body, "utf8");
        }
        const inFlight = this.inFlightCaseReads.get(uri.toString());
        if (inFlight) {
          return inFlight;
        }

        const readPromise = this.readCaseDocument(uri, parts).finally(() => {
          this.inFlightCaseReads.delete(uri.toString());
        });
        this.inFlightCaseReads.set(uri.toString(), readPromise);
        return readPromise;
      }

      throw vscode.FileSystemError.FileNotFound(uri);
    } catch (error) {
      await this.logger.log({
        level: "error",
        event: "case.get.failed",
        source: "provider",
        operation: "readFile",
        entityType: "file",
        entityId: uri.path,
        virtualPath: uri.toString(),
        outcome: "failed",
        errorCode: normalizeErrorCode(error),
        message: error instanceof Error ? error.message : String(error)
      });
      throw asFsError(error, uri);
    }
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const text = Buffer.from(content).toString("utf8");
    try {
      const parts = splitPath(uri);
      if (!(parts.length === 4 && parts[0] === "plans" && parts[2] === "cases")) {
        throw vscode.FileSystemError.NoPermissions("Only case documents are writable.");
      }

      const planId = await this.resolvePlanId(parts[1]);
      const caseId = this.resolveCaseId(planId, parts[3]);
      const session = this.caseSessionCache.get(uri.toString());
      if (!session) {
        throw new KiwiError(
          "ValidationFailed",
          "Case document session is missing. Reopen the file and try again."
        );
      }
      if (session.caseId !== caseId || session.planId !== planId) {
        throw new KiwiError(
          "ValidationFailed",
          "Case document identity could not be verified. Reopen the file and try again."
        );
      }

      const parsed = parseCaseDocument(text);
      const { adapter, config } = await this.clientFactory();
      const latestHistory = await adapter.getCaseHistory(config, caseId);
      const latestVersionToken = deriveVersionToken(latestHistory);
      if (session.versionToken !== latestVersionToken) {
        throw new KiwiError("ConflictDetected", "Case was updated remotely.");
      }

      await this.logger.log({
        level: "info",
        event: "case.update.started",
        source: "provider",
        operation: "writeFile",
        entityType: "case",
        entityId: String(caseId),
        virtualPath: uri.toString(),
        outcome: "started"
      });
      await adapter.updateCaseText(config, caseId, parsed.body);
      const refreshedHistory = await adapter.getCaseHistory(config, caseId);
      this.updateCaseCaches(uri, {
        caseId,
        planId,
        versionToken: deriveVersionToken(refreshedHistory),
        body: parsed.body,
        size: Buffer.byteLength(parsed.body, "utf8")
      });
      await this.logger.log({
        level: "info",
        event: "case.update.succeeded",
        source: "provider",
        operation: "writeFile",
        entityType: "case",
        entityId: String(caseId),
        virtualPath: uri.toString(),
        outcome: "succeeded"
      });
      void vscode.window.showInformationMessage("Case saved successfully.");
      this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch (error) {
      await this.logger.log({
        level: "error",
        event: "case.update.failed",
        source: "provider",
        operation: "writeFile",
        entityType: "case",
        entityId: uri.path,
        virtualPath: uri.toString(),
        outcome: "failed",
        errorCode: normalizeErrorCode(error),
        message: error instanceof Error ? error.message : String(error)
      });
      void vscode.window.showErrorMessage(humanMessage(error));
      throw asFsError(error, uri);
    }
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions("Create is not supported in v1.");
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions("Delete is not supported in v1.");
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("Rename is not supported in v1.");
  }

  async refreshCaseDocument(uri: vscode.Uri): Promise<Uint8Array> {
    this.caseContentCache.delete(uri.toString());
    return this.readFile(uri);
  }

  refreshListings(): void {
    this.planListCache.clear();
    this.caseListCache.clear();
    this.planCache.clear();
    this.planDirCache.clear();
    this.caseCache.clear();
    this.caseFileCache.clear();
  }

  getCachedCaseDocument(uri: vscode.Uri): CaseDocumentCacheEntry | undefined {
    return this.caseContentCache.get(uri.toString());
  }

  releaseCaseDocument(uri: vscode.Uri): void {
    const key = uri.toString();
    this.caseContentCache.delete(key);
    this.caseSessionCache.delete(key);
  }

  private async resolvePlanId(segment: string): Promise<number> {
    const cached = this.planDirCache.get(segment);
    if (cached !== undefined) {
      return cached;
    }

    const fallback = parseNumericPrefix(segment);
    if (fallback !== undefined) {
      return fallback;
    }

    throw new KiwiError("NotFound", `Plan segment ${segment} could not be resolved.`);
  }

  private resolveCaseId(planId: number, filename: string): number {
    const cached = this.caseFileCache.get(`${planId}:${filename}`);
    if (cached) {
      return cached.caseId;
    }

    const fallback = parseNumericPrefix(filename);
    if (fallback !== undefined) {
      return fallback;
    }

    throw new KiwiError("NotFound", `Case file ${filename} could not be resolved.`);
  }

  private async resolveNode(uri: vscode.Uri): Promise<{ type: vscode.FileType; size?: number }> {
    const parts = splitPath(uri);
    if (parts.length === 0) {
      return { type: vscode.FileType.Directory };
    }
    if (parts.length === 1 && parts[0] === "plans") {
      return { type: vscode.FileType.Directory };
    }
    if (parts.length === 2 && parts[0] === "plans") {
      return { type: vscode.FileType.Directory };
    }
    if (parts.length === 3 && parts[0] === "plans" && parts[2] === "cases") {
      return { type: vscode.FileType.Directory };
    }
    if (parts.length === 3 && parts[0] === "plans" && parts[2] === "plan.json") {
      return { type: vscode.FileType.File };
    }
    if (parts.length === 4 && parts[0] === "plans" && parts[2] === "cases") {
      return { type: vscode.FileType.File };
    }

    throw vscode.FileSystemError.FileNotFound(uri);
  }

  private async readCaseDocument(uri: vscode.Uri, parts: string[]): Promise<Uint8Array> {
    logInBackground(this.logger, {
      level: "info",
      event: "case.get.started",
      source: "provider",
      operation: "readFile",
      entityType: "case",
      entityId: parts[3],
      virtualPath: uri.toString(),
      outcome: "started"
    });
    const planId = await this.resolvePlanId(parts[1]);
    const caseId = this.resolveCaseId(planId, parts[3]);
    const { adapter, config } = await this.clientFactory();
    const [remoteCase, history] = await Promise.all([
      adapter.getCaseBody(config, caseId, planId),
      adapter.getCaseHistory(config, caseId)
    ]);
    const versionToken = deriveVersionToken(history);
    const document = renderCaseDocument(toCaseDocumentData(remoteCase));
    const content = Buffer.from(document, "utf8");
    this.updateCaseCaches(uri, {
      caseId,
      planId,
      versionToken,
      body: document,
      size: content.byteLength
    });
    logInBackground(this.logger, {
      level: "info",
      event: "document.rendered",
      source: "documentCodec",
      operation: "readFile",
      entityType: "case",
      entityId: String(caseId),
      virtualPath: uri.toString(),
      outcome: "succeeded"
    });
    logInBackground(this.logger, {
      level: "info",
      event: "case.get.succeeded",
      source: "provider",
      operation: "readFile",
      entityType: "case",
      entityId: String(caseId),
      virtualPath: uri.toString(),
      outcome: "succeeded"
    });
    return content;
  }

  private setStatCache(uri: vscode.Uri, type: vscode.FileType, size: number): void {
    const previous = this.statCache.get(uri.toString());
    const stamp = Date.now();
    this.statCache.set(uri.toString(), {
      type,
      ctime: previous?.ctime ?? stamp,
      mtime: stamp,
      size
    });
  }

  private updateCaseCaches(
    uri: vscode.Uri,
    value: Omit<CaseDocumentCacheEntry, "mtime">
  ): void {
    const previous = this.caseContentCache.get(uri.toString());
    const mtime = Date.now();
    const entry: CaseDocumentCacheEntry = {
      ...value,
      mtime
    };
    this.caseContentCache.set(uri.toString(), entry);
    this.caseSessionCache.set(uri.toString(), {
      caseId: entry.caseId,
      planId: entry.planId,
      versionToken: entry.versionToken
    });
    this.statCache.set(uri.toString(), {
      type: vscode.FileType.File,
      ctime: previous?.mtime ?? mtime,
      mtime,
      size: entry.size
    });
  }
}

function splitPath(uri: vscode.Uri): string[] {
  return uri.path.split("/").filter(Boolean);
}

function normalizeErrorCode(error: unknown): string {
  if (error instanceof KiwiError) {
    return error.code;
  }
  if (error instanceof vscode.FileSystemError) {
    return error.name;
  }
  return "UnknownError";
}

function humanMessage(error: unknown): string {
  if (error instanceof KiwiError) {
    switch (error.code) {
      case "AuthenticationFailed":
        return "認証情報または設定が不足しています。";
      case "AuthorizationFailed":
        return "権限不足のため操作できません。";
      case "ConnectionFailed":
        return "接続に失敗しました。";
      case "NotFound":
        return "対象が見つかりません。";
      case "ValidationFailed":
        return "Case Document を開き直してから再保存してください。";
      case "ConflictDetected":
        return "他の更新が入ったため保存できません。";
      case "ApiUnsupported":
        return "この操作はまだサポートされていません。";
    }
  }

  return error instanceof Error ? error.message : String(error);
}

function logInBackground(
  logger: JsonlLogger,
  event: Parameters<JsonlLogger["log"]>[0]
): void {
  void logger.log(event).catch(() => undefined);
}

function asFsError(error: unknown, uri: vscode.Uri): Error {
  if (error instanceof vscode.FileSystemError) {
    return error;
  }
  if (error instanceof KiwiError) {
    switch (error.code) {
      case "AuthenticationFailed":
      case "AuthorizationFailed":
      case "ConnectionFailed":
      case "ApiUnsupported":
        return vscode.FileSystemError.NoPermissions(error.message);
      case "NotFound":
        return vscode.FileSystemError.FileNotFound(uri);
      case "ValidationFailed":
      case "ConflictDetected":
        return vscode.FileSystemError.NoPermissions(error.message);
    }
  }

  return error instanceof Error ? error : new Error(String(error));
}
