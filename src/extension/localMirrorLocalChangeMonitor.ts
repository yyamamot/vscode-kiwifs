import * as path from "node:path";
import * as vscode from "vscode";
import {
  LocalMirrorManifest,
  readLocalMirrorManifest
} from "./localMirrorService";
import {
  buildFallbackLocalMirrorScmTarget,
  buildLocalMirrorScmResource,
  hashLocalMirrorBody,
  sameLocalMirrorCase
} from "./localMirrorScmSupport";
import {
  LocalMirrorScmResource,
  LocalMirrorScmState
} from "./localMirrorSourceControl";

const LOCAL_MIRROR_DIR = ".kiwi-mirror";
const LOCAL_MIRROR_MANIFEST = "kiwi-mirror.json";
export const LOCAL_MIRROR_CHANGE_DEBOUNCE_MS = 1000;
export const LOCAL_MIRROR_CHANGE_MAX_WAIT_MS = 5000;

interface WorkspaceFolderLike {
  uri: { fsPath: string };
}

interface WatcherLike {
  onDidChange(listener: (uri: vscode.Uri) => unknown): vscode.Disposable;
  onDidCreate(listener: (uri: vscode.Uri) => unknown): vscode.Disposable;
  onDidDelete(listener: (uri: vscode.Uri) => unknown): vscode.Disposable;
  dispose(): void;
}

export interface LocalMirrorLocalChangeMonitorDeps {
  getWorkspaceFolders(): readonly WorkspaceFolderLike[] | undefined;
  readLocalFile(localPath: string): Promise<string>;
  readManifest(manifestPath: string): Promise<LocalMirrorManifest>;
  findManifestFiles(folder: WorkspaceFolderLike): Promise<readonly vscode.Uri[]>;
  createFileSystemWatcher(folder: WorkspaceFolderLike): WatcherLike;
  getLocalMirrorScmState(): LocalMirrorScmState | undefined;
  setLocalMirrorScmState(state: LocalMirrorScmState): void;
  clearLocalMirrorScmState(): void;
  setTreeCompareSnapshot?(state: LocalMirrorScmState): void;
  clearTreeCompareSnapshot?(): void;
  onLocalOnlyRefresh?(state: LocalMirrorScmState): void;
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

interface PendingMirrorRoot {
  debounceTimer?: ReturnType<typeof setTimeout>;
  maxWaitTimer?: ReturnType<typeof setTimeout>;
}

function isPathInsideOrEqual(parentPath: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function mirrorRootForWorkspace(workspaceRoot: string): string {
  return path.join(workspaceRoot, LOCAL_MIRROR_DIR);
}

function manifestPathForMirrorRoot(mirrorRootPath: string): string {
  return path.join(mirrorRootPath, LOCAL_MIRROR_MANIFEST);
}

function isLocalMirrorWatchedFile(filePath: string): boolean {
  return path.basename(filePath) === LOCAL_MIRROR_MANIFEST || path.extname(filePath).toLowerCase() === ".md";
}

function resolveMirrorRootFromChangedPath(
  deps: LocalMirrorLocalChangeMonitorDeps,
  changedPath: string
): string | undefined {
  for (const folder of deps.getWorkspaceFolders() ?? []) {
    const mirrorRootPath = mirrorRootForWorkspace(folder.uri.fsPath);
    if (isPathInsideOrEqual(mirrorRootPath, changedPath)) {
      return mirrorRootPath;
    }
  }
  return undefined;
}

function selectBaselineState(
  currentState: LocalMirrorScmState | undefined,
  localChangedResources: readonly LocalMirrorScmResource[]
): LocalMirrorScmState | undefined {
  if (currentState) {
    return currentState;
  }
  const target = buildFallbackLocalMirrorScmTarget(localChangedResources);
  return target ? { target, resources: [] } : undefined;
}

function mergeLocalOnlyResources(input: {
  baselineState: LocalMirrorScmState;
  localChangedResources: readonly LocalMirrorScmResource[];
}): LocalMirrorScmState {
  const localChangedByCase = new Map(
    input.localChangedResources.map((resource) => [`${resource.plan.id}:${resource.caseRef.id}`, resource])
  );
  const resources: LocalMirrorScmResource[] = [];
  const consumed = new Set<string>();

  for (const resource of input.baselineState.resources) {
    const key = `${resource.plan.id}:${resource.caseRef.id}`;
    const localChanged = localChangedByCase.get(key);
    if (localChanged) {
      resources.push({
        ...localChanged,
        status: resource.status === "RemoteChanged" || resource.status === "Conflict"
          ? "Conflict"
          : "LocalChanged"
      });
      consumed.add(key);
      continue;
    }

    if (resource.status === "RemoteChanged" || resource.status === "Conflict") {
      resources.push(resource);
    }
  }

  for (const resource of input.localChangedResources) {
    const alreadyIncluded = consumed.has(`${resource.plan.id}:${resource.caseRef.id}`);
    if (!alreadyIncluded && !resources.some((existing) => sameLocalMirrorCase(existing, resource))) {
      resources.push(resource);
    }
  }

  return {
    target: input.baselineState.target,
    resources
  };
}

async function buildLocalChangedResources(
  deps: LocalMirrorLocalChangeMonitorDeps,
  mirrorRootPath: string
): Promise<LocalMirrorScmResource[] | undefined> {
  let manifest: LocalMirrorManifest;
  try {
    manifest = await deps.readManifest(manifestPathForMirrorRoot(mirrorRootPath));
  } catch {
    return undefined;
  }

  const resources: LocalMirrorScmResource[] = [];
  for (const entry of Object.values(manifest.cases)) {
    if (!entry.downloadedContentHash) {
      continue;
    }
    const localPath = path.resolve(path.dirname(mirrorRootPath), entry.localPath);
    let localBody: string;
    try {
      localBody = await deps.readLocalFile(localPath);
    } catch {
      continue;
    }
    if (hashLocalMirrorBody(localBody) !== entry.downloadedContentHash) {
      resources.push(buildLocalMirrorScmResource({
        entry,
        localPath,
        status: "LocalChanged"
      }));
    }
  }
  return resources;
}

async function refreshMirrorRootLocalChanges(
  deps: LocalMirrorLocalChangeMonitorDeps,
  mirrorRootPath: string
): Promise<void> {
  const localChangedResources = await buildLocalChangedResources(deps, mirrorRootPath);
  if (!localChangedResources) {
    return;
  }
  const baselineState = selectBaselineState(
    deps.getLocalMirrorScmState(),
    localChangedResources
  );
  if (!baselineState) {
    deps.clearLocalMirrorScmState();
    deps.clearTreeCompareSnapshot?.();
    return;
  }

  const nextState = mergeLocalOnlyResources({
    baselineState,
    localChangedResources
  });
  if (nextState.resources.length === 0) {
    deps.clearLocalMirrorScmState();
    deps.clearTreeCompareSnapshot?.();
    return;
  }

  deps.setLocalMirrorScmState(nextState);
  deps.setTreeCompareSnapshot?.(nextState);
  deps.onLocalOnlyRefresh?.(nextState);
}

export function createLocalMirrorLocalChangeMonitor(
  deps: LocalMirrorLocalChangeMonitorDeps
): vscode.Disposable {
  const workspaceFolders = deps.getWorkspaceFolders();
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { dispose() {} };
  }

  let disposed = false;
  const pendingByMirrorRoot = new Map<string, PendingMirrorRoot>();
  const disposables: vscode.Disposable[] = [];

  const flushMirrorRoot = (mirrorRootPath: string) => {
    if (disposed) {
      return;
    }
    const pending = pendingByMirrorRoot.get(mirrorRootPath);
    if (pending?.debounceTimer) {
      deps.clearTimeout(pending.debounceTimer);
    }
    if (pending?.maxWaitTimer) {
      deps.clearTimeout(pending.maxWaitTimer);
    }
    pendingByMirrorRoot.delete(mirrorRootPath);
    void refreshMirrorRootLocalChanges(deps, mirrorRootPath);
  };

  const scheduleMirrorRoot = (mirrorRootPath: string) => {
    if (disposed) {
      return;
    }
    const pending = pendingByMirrorRoot.get(mirrorRootPath) ?? {};
    if (pending.debounceTimer) {
      deps.clearTimeout(pending.debounceTimer);
    }
    pending.debounceTimer = deps.setTimeout(
      () => flushMirrorRoot(mirrorRootPath),
      LOCAL_MIRROR_CHANGE_DEBOUNCE_MS
    );
    if (!pending.maxWaitTimer) {
      pending.maxWaitTimer = deps.setTimeout(
        () => flushMirrorRoot(mirrorRootPath),
        LOCAL_MIRROR_CHANGE_MAX_WAIT_MS
      );
    }
    pendingByMirrorRoot.set(mirrorRootPath, pending);
  };

  const handleChange = (uri: vscode.Uri) => {
    if (uri.scheme !== "file") {
      return;
    }
    if (!isLocalMirrorWatchedFile(uri.fsPath)) {
      return;
    }
    const mirrorRootPath = resolveMirrorRootFromChangedPath(deps, uri.fsPath);
    if (mirrorRootPath) {
      scheduleMirrorRoot(mirrorRootPath);
    }
  };

  const scanExistingMirrorRoots = async () => {
    for (const folder of workspaceFolders) {
      if (disposed) {
        return;
      }
      let manifestUris: readonly vscode.Uri[];
      try {
        manifestUris = await deps.findManifestFiles(folder);
      } catch {
        continue;
      }
      for (const manifestUri of manifestUris) {
        if (disposed || manifestUri.scheme !== "file") {
          continue;
        }
        const mirrorRootPath = path.dirname(manifestUri.fsPath);
        if (isPathInsideOrEqual(mirrorRootForWorkspace(folder.uri.fsPath), mirrorRootPath)) {
          scheduleMirrorRoot(mirrorRootPath);
        }
      }
    }
  };

  for (const folder of workspaceFolders) {
    const watcher = deps.createFileSystemWatcher(folder);
    disposables.push(
      watcher,
      watcher.onDidChange(handleChange),
      watcher.onDidCreate(handleChange),
      watcher.onDidDelete(handleChange)
    );
  }

  void scanExistingMirrorRoots();

  return {
    dispose() {
      disposed = true;
      for (const pending of pendingByMirrorRoot.values()) {
        if (pending.debounceTimer) {
          deps.clearTimeout(pending.debounceTimer);
        }
        if (pending.maxWaitTimer) {
          deps.clearTimeout(pending.maxWaitTimer);
        }
      }
      pendingByMirrorRoot.clear();
      for (const disposable of disposables) {
        disposable.dispose();
      }
    }
  };
}

export function createVscodeLocalMirrorLocalChangeMonitor(input: {
  getLocalMirrorScmState(): LocalMirrorScmState | undefined;
  setLocalMirrorScmState(state: LocalMirrorScmState): void;
  clearLocalMirrorScmState(): void;
  setTreeCompareSnapshot?(state: LocalMirrorScmState): void;
  clearTreeCompareSnapshot?(): void;
  onLocalOnlyRefresh?(state: LocalMirrorScmState): void;
}): vscode.Disposable {
  return createLocalMirrorLocalChangeMonitor({
    getWorkspaceFolders: () => vscode.workspace.workspaceFolders,
    async readLocalFile(localPath) {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(localPath));
      return new TextDecoder().decode(bytes);
    },
    readManifest: readLocalMirrorManifest,
    async findManifestFiles(folder) {
      return vscode.workspace.findFiles(
        new vscode.RelativePattern(folder.uri.fsPath, `${LOCAL_MIRROR_DIR}/${LOCAL_MIRROR_MANIFEST}`)
      );
    },
    createFileSystemWatcher(folder) {
      return vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder.uri.fsPath, `${LOCAL_MIRROR_DIR}/**`)
      );
    },
    getLocalMirrorScmState: input.getLocalMirrorScmState,
    setLocalMirrorScmState: input.setLocalMirrorScmState,
    clearLocalMirrorScmState: input.clearLocalMirrorScmState,
    setTreeCompareSnapshot: input.setTreeCompareSnapshot,
    clearTreeCompareSnapshot: input.clearTreeCompareSnapshot,
    onLocalOnlyRefresh: input.onLocalOnlyRefresh,
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle)
  });
}
