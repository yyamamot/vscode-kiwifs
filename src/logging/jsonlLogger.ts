import { mkdir, appendFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { StructuredLogEvent } from "../types";
import { isLocalEnvResolved, localEnvValue } from "../config/localEnv";

type RuntimeLogResolutionContext = {
  runtimeRootFsPath?: string;
  workspaceFolderFsPath?: string;
  workspaceFileFsPath?: string;
};

export class JsonlLogger {
  readonly runId = randomUUID();
  private readonly enabled: boolean;
  private readonly configuredPath: string;
  private targetPath: string | undefined;
  private sessionStarted = false;

  constructor() {
    const isDebug = process.env.KIWI_RUNTIME_MODE === "debug-f5";
    this.enabled = isDebug;
    this.configuredPath = process.env.KIWI_JSONL_PATH ?? defaultRuntimeLogPath();
  }

  async log(
    event: Omit<StructuredLogEvent, "ts" | "runId">
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const targetPath = this.getResolvedRuntimeLogPath();
    if (!targetPath) {
      return;
    }
    await this.ensureSessionStarted(targetPath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await this.appendEvent(targetPath, event);
  }

  getResolvedRuntimeLogPath(): string | undefined {
    if (!this.targetPath) {
      this.targetPath = resolveRuntimeLogPath(
        this.configuredPath,
        currentResolutionContext()
      );
    }
    return this.targetPath;
  }

  getResolvedRuntimeLogDirectory(): string | undefined {
    const targetPath = this.getResolvedRuntimeLogPath();
    return targetPath ? path.dirname(targetPath) : defaultRuntimeLogDirectory(currentResolutionContext());
  }

  resetRuntimeLogState(): void {
    this.sessionStarted = false;
  }

  private async ensureSessionStarted(targetPath: string): Promise<void> {
    if (this.sessionStarted) {
      return;
    }

    this.sessionStarted = true;
    await mkdir(path.dirname(targetPath), { recursive: true });
    await this.appendEvent(targetPath, {
      level: "info",
      event: "session.started",
      source: "runtime",
      operation: "session",
      entityType: "runtimeLog",
      entityId: this.runId,
      virtualPath: targetPath,
      outcome: "started",
      details: `mode=debug-f5 baseUrlConfigured=${isBaseUrlConfigured()} runtimeRootConfigured=${isRuntimeRootConfigured()} workspaceResolved=${isWorkspaceResolved()} envPathResolved=${isLocalEnvResolved()}`
    });
  }

  private async appendEvent(
    targetPath: string,
    event: Omit<StructuredLogEvent, "ts" | "runId">
  ): Promise<void> {
    await appendFile(
      targetPath,
      JSON.stringify({
        ts: new Date().toISOString(),
        runId: this.runId,
        ...event
      }) + "\n",
      "utf8"
    );
  }
}

export function defaultRuntimeLogPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(".kiwi-logs", "runtime", `run-${timestamp}-${process.pid}.jsonl`);
}

export function resolveRuntimeLogPath(
  targetPath: string,
  context: RuntimeLogResolutionContext
): string | undefined {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  if (context.runtimeRootFsPath) {
    return path.join(context.runtimeRootFsPath, targetPath);
  }

  if (context.workspaceFolderFsPath) {
    return path.join(context.workspaceFolderFsPath, targetPath);
  }

  if (context.workspaceFileFsPath) {
    return path.join(path.dirname(context.workspaceFileFsPath), targetPath);
  }

  return undefined;
}

export function defaultRuntimeLogDirectory(
  context: RuntimeLogResolutionContext
): string | undefined {
  return resolveRuntimeLogPath(path.join(".kiwi-logs", "runtime", "placeholder.jsonl"), context)
    ? path.dirname(resolveRuntimeLogPath(path.join(".kiwi-logs", "runtime", "placeholder.jsonl"), context)!)
    : undefined;
}

function currentResolutionContext(): RuntimeLogResolutionContext {
  const runtimeRootFsPath = process.env.KIWI_RUNTIME_ROOT?.trim() || undefined;
  const workspaceFolder = vscode.workspace.workspaceFolders?.find(
    (folder) => folder.uri.scheme === "file"
  );
  const workspaceFile = vscode.workspace.workspaceFile;
  return {
    runtimeRootFsPath,
    workspaceFolderFsPath: workspaceFolder?.uri.fsPath,
    workspaceFileFsPath: workspaceFile?.scheme === "file" ? workspaceFile.fsPath : undefined
  };
}

function isBaseUrlConfigured(): boolean {
  const configured =
    vscode.workspace.getConfiguration("kiwi").get<string>("baseUrl") ??
    process.env.KIWI_BASE_URL ??
    localEnvValue("KIWI_BASE_URL");
  return Boolean(configured?.trim());
}

function isWorkspaceResolved(): boolean {
  const context = currentResolutionContext();
  return Boolean(context.workspaceFolderFsPath || context.workspaceFileFsPath);
}

function isRuntimeRootConfigured(): boolean {
  return Boolean(process.env.KIWI_RUNTIME_ROOT?.trim());
}
