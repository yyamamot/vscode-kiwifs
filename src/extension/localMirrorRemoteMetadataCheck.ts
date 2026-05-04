import * as path from "node:path";
import { deriveVersionToken } from "../domain/versionToken";
import { KiwiAdapter } from "../adapter/types";
import { KiwiConfig } from "../types";
import {
  LocalMirrorManifest,
  LocalMirrorManifestEntry,
  readLocalMirrorManifest
} from "./localMirrorService";
import {
  buildLocalMirrorScmResource,
  hashLocalMirrorBody,
  replaceLocalMirrorScmResource
} from "./localMirrorScmSupport";
import {
  LocalMirrorScmResource,
  LocalMirrorScmState
} from "./localMirrorSourceControl";

export const LOCAL_MIRROR_REMOTE_METADATA_AUTO_MAX_CASES = 25;
export const LOCAL_MIRROR_REMOTE_METADATA_CONCURRENCY = 2;
export const LOCAL_MIRROR_REMOTE_METADATA_COOLDOWN_MS = 10 * 60 * 1000;

type ClientFactory = () => Promise<{
  adapter: KiwiAdapter;
  config: KiwiConfig;
}>;

export interface LocalMirrorRemoteMetadataCheckDeps {
  workspaceRoot: string | undefined;
  clientFactory: ClientFactory;
  readLocalFile(localPath: string): Promise<string>;
  readManifest(manifestPath: string): Promise<LocalMirrorManifest>;
  getLocalMirrorScmState(): LocalMirrorScmState | undefined;
  setLocalMirrorScmState(state: LocalMirrorScmState): void;
  clearLocalMirrorScmState(): void;
  setTreeCompareSnapshot?(state: LocalMirrorScmState): void;
  clearTreeCompareSnapshot?(): void;
  now(): number;
}

interface Candidate {
  resource: LocalMirrorScmResource;
  entry: LocalMirrorManifestEntry;
}

interface CheckResult {
  resource: LocalMirrorScmResource;
  nextResource?: LocalMirrorScmResource;
}

function manifestPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".kiwi-mirror", "kiwi-mirror.json");
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R | undefined>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const result = await mapper(items[currentIndex]);
        if (result !== undefined) {
          results.push(result);
        }
      }
    })
  );
  return results;
}

async function buildCandidates(
  deps: LocalMirrorRemoteMetadataCheckDeps,
  resources: readonly LocalMirrorScmResource[]
): Promise<Candidate[]> {
  if (!deps.workspaceRoot) {
    return [];
  }
  let manifest: LocalMirrorManifest;
  try {
    manifest = await deps.readManifest(manifestPath(deps.workspaceRoot));
  } catch {
    return [];
  }
  const entriesByCaseId = new Map(
    Object.values(manifest.cases).map((entry) => [entry.caseId, entry])
  );
  return resources
    .map((resource) => {
      const entry = entriesByCaseId.get(resource.caseRef.id);
      return entry ? { resource, entry } : undefined;
    })
    .filter((candidate): candidate is Candidate => Boolean(candidate));
}

async function evaluateCandidate(
  deps: LocalMirrorRemoteMetadataCheckDeps,
  candidate: Candidate
): Promise<CheckResult | undefined> {
  if (!deps.workspaceRoot || !candidate.entry.downloadedContentHash) {
    return undefined;
  }
  const localPath = path.resolve(deps.workspaceRoot, candidate.entry.localPath);
  let localBody: string;
  try {
    localBody = await deps.readLocalFile(localPath);
  } catch {
    return undefined;
  }

  const localChanged = hashLocalMirrorBody(localBody) !== candidate.entry.downloadedContentHash;
  let latestVersionToken: string;
  try {
    const { adapter, config } = await deps.clientFactory();
    latestVersionToken = deriveVersionToken(
      await adapter.getCaseHistory(config, candidate.entry.caseId)
    );
  } catch {
    return undefined;
  }
  const remoteChanged = latestVersionToken !== candidate.entry.downloadedVersionToken;
  const status = localChanged
    ? remoteChanged
      ? "Conflict"
      : "LocalChanged"
    : remoteChanged
      ? "RemoteChanged"
      : undefined;

  return {
    resource: candidate.resource,
    nextResource: status
      ? buildLocalMirrorScmResource({
          entry: candidate.entry,
          localPath,
          status
        })
      : undefined
  };
}

export function createLocalMirrorRemoteMetadataChecker(
  deps: LocalMirrorRemoteMetadataCheckDeps
) {
  const checkedAtByCaseId = new Map<number, number>();

  const run = async (
    resources: readonly LocalMirrorScmResource[],
    options: {
      respectCooldown: boolean;
      maxCases?: number;
    }
  ): Promise<boolean> => {
    const baseline = deps.getLocalMirrorScmState();
    if (!baseline) {
      return false;
    }

    const now = deps.now();
    const selectedResources: LocalMirrorScmResource[] = [];
    const seen = new Set<number>();
    for (const resource of resources) {
      if (seen.has(resource.caseRef.id)) {
        continue;
      }
      seen.add(resource.caseRef.id);
      if (options.respectCooldown) {
        const checkedAt = checkedAtByCaseId.get(resource.caseRef.id);
        if (
          checkedAt !== undefined &&
          now - checkedAt < LOCAL_MIRROR_REMOTE_METADATA_COOLDOWN_MS
        ) {
          continue;
        }
      }
      checkedAtByCaseId.set(resource.caseRef.id, now);
      selectedResources.push(resource);
      if (options.maxCases !== undefined && selectedResources.length >= options.maxCases) {
        break;
      }
    }
    if (selectedResources.length === 0) {
      return false;
    }

    const candidates = await buildCandidates(deps, selectedResources);
    const results = await mapWithConcurrency(
      candidates,
      LOCAL_MIRROR_REMOTE_METADATA_CONCURRENCY,
      (candidate) => evaluateCandidate(deps, candidate)
    );
    if (results.length === 0) {
      return false;
    }

    let nextState = deps.getLocalMirrorScmState();
    if (!nextState) {
      return false;
    }
    for (const result of results) {
      nextState = replaceLocalMirrorScmResource(
        nextState,
        result.nextResource,
        result.resource
      );
    }

    if (nextState.resources.length === 0) {
      deps.clearLocalMirrorScmState();
      deps.clearTreeCompareSnapshot?.();
      return true;
    }
    deps.setLocalMirrorScmState(nextState);
    deps.setTreeCompareSnapshot?.(nextState);
    return true;
  };

  return {
    checkCurrentLocalChangedResources(): Promise<boolean> {
      const state = deps.getLocalMirrorScmState();
      if (!state) {
        return Promise.resolve(false);
      }
      return run(
        state.resources.filter((resource) => resource.status === "LocalChanged"),
        {
          respectCooldown: true,
          maxCases: LOCAL_MIRROR_REMOTE_METADATA_AUTO_MAX_CASES
        }
      );
    },
    checkCurrentMirrorMetadata(): Promise<boolean> {
      const state = deps.getLocalMirrorScmState();
      if (!state) {
        return Promise.resolve(false);
      }
      return run(state.resources, {
        respectCooldown: false
      });
    }
  };
}
