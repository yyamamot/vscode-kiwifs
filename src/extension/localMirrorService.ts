import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { KiwiAdapter } from "../adapter/types";
import { KiwiError } from "../domain/errors";
import { caseFileName, planDirectoryName } from "../domain/pathCodec";
import { deriveVersionToken } from "../domain/versionToken";
import { KiwiConfig, KiwiPlan, PlanCaseRef } from "../types";

export type LocalMirrorCompareStatus =
  | "unchanged"
  | "modified locally"
  | "remote changed"
  | "conflict"
  | "missing locally"
  | "missing remote";

export type LocalMirrorScmResourceStatus =
  | "LocalChanged"
  | "RemoteChanged"
  | "Conflict";

export interface LocalMirrorManifestEntry {
  caseId: number;
  planId: number;
  localPath: string;
  downloadedVersionToken: string;
  downloadedContentHash?: string;
  lastDownloadedAt: string;
  lastUploadedAt?: string;
}

export interface LocalMirrorManifest {
  version: 1;
  cases: Record<string, LocalMirrorManifestEntry>;
}

export interface LocalMirrorCompareResult {
  status: LocalMirrorCompareStatus;
  localPath: string;
  localBody: string;
  remoteBody: string;
  downloadedVersionToken: string;
  latestVersionToken?: string;
}

export interface LocalMirrorPlanDownloadResult {
  downloaded: number;
  overwritten: number;
  skipped: number;
  failed: number;
}

export interface LocalMirrorPlanUploadResult {
  uploaded: number;
  skipped: number;
  failed: number;
  uploadedTargets: LocalMirrorTarget[];
}

export interface LocalMirrorPlanStatusRow {
  caseId: number;
  summary: string;
  localPath: string;
  status: LocalMirrorCompareStatus;
}

export interface LocalMirrorScmComparableCase {
  plan: KiwiPlan;
  caseRef: PlanCaseRef;
  compare: LocalMirrorCompareResult;
}

export interface LocalMirrorPlanSnapshot {
  rows: LocalMirrorPlanStatusRow[];
  comparableCases: LocalMirrorScmComparableCase[];
}

export type LocalMirrorTarget = {
  plan: KiwiPlan;
  caseRef: PlanCaseRef;
};

type DownloadCaseOptions = {
  force?: boolean;
};

type KiwiClientFactory = () => Promise<{
  adapter: KiwiAdapter;
  config: KiwiConfig;
}>;

export function createEmptyLocalMirrorManifest(): LocalMirrorManifest {
  return {
    version: 1,
    cases: {}
  };
}

export async function readLocalMirrorManifest(
  manifestPath: string
): Promise<LocalMirrorManifest> {
  try {
    const content = await readFile(manifestPath, "utf8");
    return JSON.parse(content) as LocalMirrorManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyLocalMirrorManifest();
    }
    throw error;
  }
}

export async function writeLocalMirrorManifest(
  manifestPath: string,
  manifest: LocalMirrorManifest
): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function buildLocalMirrorRelativePath(plan: KiwiPlan, caseRef: PlanCaseRef): string {
  return path.join(".kiwi-mirror", "plans", planDirectoryName(plan), "cases", caseFileName(caseRef));
}

export function determineLocalMirrorStatus(input: {
  hasLocal: boolean;
  hasRemote: boolean;
  localChanged: boolean;
  remoteChanged: boolean;
}): LocalMirrorCompareStatus {
  if (!input.hasRemote) {
    return "missing remote";
  }
  if (!input.hasLocal) {
    return "missing locally";
  }
  if (!input.localChanged && !input.remoteChanged) {
    return "unchanged";
  }
  if (input.localChanged && !input.remoteChanged) {
    return "modified locally";
  }
  if (!input.localChanged && input.remoteChanged) {
    return "remote changed";
  }
  return "conflict";
}

export function toLocalMirrorScmResourceStatus(
  status: LocalMirrorCompareStatus
): LocalMirrorScmResourceStatus | undefined {
  switch (status) {
    case "modified locally":
      return "LocalChanged";
    case "remote changed":
      return "RemoteChanged";
    case "conflict":
      return "Conflict";
    default:
      return undefined;
  }
}

export class LocalMirrorService {
  constructor(
    private readonly clientFactory: KiwiClientFactory,
    private readonly workspaceRoot: string
  ) {}

  async downloadCase(
    target: LocalMirrorTarget,
    options: DownloadCaseOptions = {}
  ): Promise<{ localPath: string }> {
    const manifestPath = this.manifestPath();
    const manifest = await readLocalMirrorManifest(manifestPath);
    const existingEntry = manifest.cases[String(target.caseRef.id)];
    const { adapter, config } = await this.clientFactory();
    const [remoteCase, history] = await Promise.all([
      adapter.getCaseBody(config, target.caseRef.id, target.plan.id),
      adapter.getCaseHistory(config, target.caseRef.id)
    ]);
    const latestVersionToken = deriveVersionToken(history);

    if (existingEntry) {
      const current = await this.compareWithEntry(target, existingEntry, {
        remoteBody: remoteCase.text,
        latestVersionToken
      });
      if (
        !options.force &&
        (current.status === "modified locally" || current.status === "conflict")
      ) {
        throw new KiwiError(
          current.status === "conflict" ? "ConflictDetected" : "ValidationFailed",
          "Local mirror has unuploaded changes. Run 'Compare Local Mirror' before downloading again."
        );
      }
    }

    const relativePath = existingEntry?.localPath ?? buildLocalMirrorRelativePath(target.plan, target.caseRef);
    const localPath = this.absolutePath(relativePath);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, remoteCase.text, "utf8");

    manifest.cases[String(target.caseRef.id)] = {
      caseId: target.caseRef.id,
      planId: target.plan.id,
      localPath: relativePath,
      downloadedVersionToken: latestVersionToken,
      downloadedContentHash: hashContent(remoteCase.text),
      lastDownloadedAt: new Date().toISOString(),
      lastUploadedAt: existingEntry?.lastUploadedAt
    };
    await writeLocalMirrorManifest(manifestPath, manifest);
    return { localPath };
  }

  async downloadPlanCases(
    plan: KiwiPlan,
    options: DownloadCaseOptions = {}
  ): Promise<LocalMirrorPlanDownloadResult> {
    const { adapter, config } = await this.clientFactory();
    const caseRefs = await adapter.listPlanCases(config, plan.id);
    const result: LocalMirrorPlanDownloadResult = {
      downloaded: 0,
      overwritten: 0,
      skipped: 0,
      failed: 0
    };

    for (const caseRef of caseRefs) {
      try {
        let wasOverwrite = false;
        if (options.force) {
          const manifest = await readLocalMirrorManifest(this.manifestPath());
          const entry = manifest.cases[String(caseRef.id)];
          if (entry) {
            const compared = await this.compareWithEntry(
              { plan, caseRef },
              entry
            ).catch(() => undefined);
            wasOverwrite =
              compared?.status === "modified locally" || compared?.status === "conflict";
          }
        }

        await this.downloadCase({ plan, caseRef }, options);
        if (wasOverwrite) {
          result.overwritten += 1;
        } else {
          result.downloaded += 1;
        }
      } catch (error) {
        if (isDownloadSkipError(error)) {
          result.skipped += 1;
          continue;
        }
        result.failed += 1;
      }
    }

    return result;
  }

  async compareCase(target: LocalMirrorTarget): Promise<LocalMirrorCompareResult> {
    const manifest = await readLocalMirrorManifest(this.manifestPath());
    const entry = manifest.cases[String(target.caseRef.id)];
    if (!entry) {
      throw new KiwiError(
        "ValidationFailed",
        "Download the case to local mirror first."
      );
    }

    return this.compareWithEntry(target, entry);
  }

  async uploadCase(
    target: LocalMirrorTarget
  ): Promise<{ localPath: string; uploadedVersionToken: string }> {
    const manifestPath = this.manifestPath();
    const manifest = await readLocalMirrorManifest(manifestPath);
    const entry = manifest.cases[String(target.caseRef.id)];
    if (!entry) {
      throw new KiwiError(
        "ValidationFailed",
        "Download the case to local mirror first."
      );
    }

    const compare = await this.compareWithEntry(target, entry);
    switch (compare.status) {
      case "modified locally":
        break;
      case "unchanged":
        throw new KiwiError("ValidationFailed", "Local mirror has no changes to upload.");
      case "remote changed":
      case "conflict":
        throw new KiwiError(
          "ConflictDetected",
          "Remote changed since download. Run 'Compare Local Mirror' before uploading."
        );
      case "missing locally":
        throw new KiwiError(
          "ValidationFailed",
          "Local mirror file is missing. Download the case again."
        );
      case "missing remote":
        throw new KiwiError("NotFound", "Remote case is missing.");
    }

    const { adapter, config } = await this.clientFactory();
    await adapter.updateCaseText(config, target.caseRef.id, compare.localBody);
    const uploadedVersionToken = deriveVersionToken(
      await adapter.getCaseHistory(config, target.caseRef.id)
    );
    manifest.cases[String(target.caseRef.id)] = {
      ...entry,
      downloadedVersionToken: uploadedVersionToken,
      downloadedContentHash: hashContent(compare.localBody),
      lastUploadedAt: new Date().toISOString()
    };
    await writeLocalMirrorManifest(manifestPath, manifest);
    return {
      localPath: compare.localPath,
      uploadedVersionToken
    };
  }

  async takeRemoteChanges(target: LocalMirrorTarget): Promise<{ localPath: string }> {
    const manifest = await readLocalMirrorManifest(this.manifestPath());
    const entry = manifest.cases[String(target.caseRef.id)];
    if (!entry) {
      throw new KiwiError(
        "ValidationFailed",
        "Download the case to local mirror first."
      );
    }

    const compare = await this.compareWithEntry(target, entry);
    switch (compare.status) {
      case "remote changed":
      case "missing locally":
        break;
      case "unchanged":
        throw new KiwiError("ValidationFailed", "Local mirror already matches remote.");
      case "modified locally":
      case "conflict":
        throw new KiwiError(
          "ConflictDetected",
          "Local mirror has local changes. Run 'Compare Local Mirror' before taking remote changes."
        );
      case "missing remote":
        throw new KiwiError("NotFound", "Remote case is missing.");
    }

    return this.downloadCase(target, { force: true });
  }

  async revealLocalMirror(target: LocalMirrorTarget): Promise<string> {
    const manifest = await readLocalMirrorManifest(this.manifestPath());
    const entry = manifest.cases[String(target.caseRef.id)];
    if (!entry) {
      throw new KiwiError(
        "ValidationFailed",
        "Download the case to local mirror first."
      );
    }

    const compare = await this.compareWithEntry(target, entry);
    if (compare.status === "missing locally") {
      throw new KiwiError(
        "ValidationFailed",
        "Local mirror file is missing. Download the case again."
      );
    }

    return compare.localPath;
  }

  async getPlanMirrorSnapshot(plan: KiwiPlan): Promise<LocalMirrorPlanSnapshot> {
    const { adapter, config } = await this.clientFactory();
    const caseRefs = await adapter.listPlanCases(config, plan.id);
    const manifest = await readLocalMirrorManifest(this.manifestPath());
    const rows: LocalMirrorPlanStatusRow[] = [];
    const comparableCases: LocalMirrorScmComparableCase[] = [];

    for (const caseRef of caseRefs) {
      const entry = manifest.cases[String(caseRef.id)];
      if (!entry) {
        rows.push({
          caseId: caseRef.id,
          summary: caseRef.summary,
          localPath: this.absolutePath(buildLocalMirrorRelativePath(plan, caseRef)),
          status: "missing locally"
        });
        continue;
      }

      const compare = await this.compareWithEntry({ plan, caseRef }, entry);
      rows.push({
        caseId: caseRef.id,
        summary: caseRef.summary,
        localPath: compare.localPath,
        status: compare.status
      });
      if (toLocalMirrorScmResourceStatus(compare.status)) {
        comparableCases.push({
          plan,
          caseRef,
          compare
        });
      }
    }

    return {
      rows,
      comparableCases
    };
  }

  async getPlanMirrorStatus(plan: KiwiPlan): Promise<LocalMirrorPlanStatusRow[]> {
    return (await this.getPlanMirrorSnapshot(plan)).rows;
  }

  async uploadPlanCases(plan: KiwiPlan): Promise<LocalMirrorPlanUploadResult> {
    const { adapter, config } = await this.clientFactory();
    const caseRefs = await adapter.listPlanCases(config, plan.id);
    const manifest = await readLocalMirrorManifest(this.manifestPath());
    const result: LocalMirrorPlanUploadResult = {
      uploaded: 0,
      skipped: 0,
      failed: 0,
      uploadedTargets: []
    };

    for (const caseRef of caseRefs) {
      const target = { plan, caseRef };
      const entry = manifest.cases[String(caseRef.id)];
      if (!entry) {
        result.skipped += 1;
        continue;
      }

      try {
        const compare = await this.compareWithEntry(target, entry);
        if (compare.status !== "modified locally") {
          result.skipped += 1;
          continue;
        }

        await this.uploadCase(target);
        result.uploaded += 1;
        result.uploadedTargets.push(target);
      } catch {
        result.failed += 1;
      }
    }

    return result;
  }

  manifestFilePath(): string {
    return this.manifestPath();
  }

  private async compareWithEntry(
    target: LocalMirrorTarget,
    entry: LocalMirrorManifestEntry,
    prefetchedRemote?: { remoteBody: string; latestVersionToken: string }
  ): Promise<LocalMirrorCompareResult> {
    const localPath = this.absolutePath(entry.localPath);
    const localBody = await this.readOptionalFile(localPath);
    const hasLocal = localBody !== undefined;

    let remoteBody = prefetchedRemote?.remoteBody;
    let latestVersionToken = prefetchedRemote?.latestVersionToken;
    let hasRemote = true;

    if (remoteBody === undefined || latestVersionToken === undefined) {
      try {
        const { adapter, config } = await this.clientFactory();
        const [remoteCase, history] = await Promise.all([
          adapter.getCaseBody(config, target.caseRef.id, target.plan.id),
          adapter.getCaseHistory(config, target.caseRef.id)
        ]);
        remoteBody = remoteCase.text;
        latestVersionToken = deriveVersionToken(history);
      } catch (error) {
        if (error instanceof KiwiError && error.code === "NotFound") {
          hasRemote = false;
          remoteBody = "";
        } else {
          throw error;
        }
      }
    }

    if (!hasRemote || !hasLocal) {
      return {
        status: determineLocalMirrorStatus({
          hasLocal,
          hasRemote,
          localChanged: false,
          remoteChanged: false
        }),
        localPath,
        localBody: localBody ?? "",
        remoteBody: remoteBody ?? "",
        downloadedVersionToken: entry.downloadedVersionToken,
        latestVersionToken
      };
    }

    const baselineContentHash = await this.resolveBaselineContentHash(
      target,
      entry,
      remoteBody ?? "",
      latestVersionToken
    );
    const localChanged = hashContent(localBody ?? "") !== baselineContentHash;
    const remoteChanged = latestVersionToken !== entry.downloadedVersionToken;
    const status = determineLocalMirrorStatus({
      hasLocal,
      hasRemote,
      localChanged,
      remoteChanged
    });

    return {
      status,
      localPath,
      localBody: localBody ?? "",
      remoteBody: remoteBody ?? "",
      downloadedVersionToken: entry.downloadedVersionToken,
      latestVersionToken
    };
  }

  private manifestPath(): string {
    return path.join(this.workspaceRoot, ".kiwi-mirror", "kiwi-mirror.json");
  }

  private absolutePath(relativePath: string): string {
    return path.resolve(this.workspaceRoot, relativePath);
  }

  private async readOptionalFile(filePath: string): Promise<string | undefined> {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private async resolveBaselineContentHash(
    target: LocalMirrorTarget,
    entry: LocalMirrorManifestEntry,
    remoteBody: string,
    latestVersionToken?: string
  ): Promise<string> {
    if (entry.downloadedContentHash) {
      return entry.downloadedContentHash;
    }

    if (latestVersionToken === entry.downloadedVersionToken) {
      return hashContent(remoteBody);
    }

    const { adapter, config } = await this.clientFactory();
    const history = await adapter.getCaseHistory(config, target.caseRef.id);
    const baselineHistory = history.find(
      (item) => deriveVersionToken([item]) === entry.downloadedVersionToken
    );

    if (!baselineHistory?.historyId) {
      throw new KiwiError(
        "ValidationFailed",
        "Local mirror baseline is missing from manifest and could not be reconstructed. Re-download the case to local mirror."
      );
    }

    try {
      const baselineVersion = await adapter.getCaseHistoryVersion(
        config,
        target.caseRef.id,
        baselineHistory.historyId
      );
      return hashContent(baselineVersion.text);
    } catch (error) {
      if (
        error instanceof KiwiError &&
        (error.code === "NotFound" || error.code === "ValidationFailed")
      ) {
        throw new KiwiError(
          "ValidationFailed",
          "Local mirror baseline is missing from manifest and could not be reconstructed. Re-download the case to local mirror."
        );
      }
      throw error;
    }
  }
}

function hashContent(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function isDownloadSkipError(error: unknown): boolean {
  return (
    error instanceof KiwiError &&
    (error.code === "ValidationFailed" || error.code === "ConflictDetected")
  );
}
