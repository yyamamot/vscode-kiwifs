import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  RelativePattern: class {
    constructor(
      public readonly base: string,
      public readonly pattern: string
    ) {}
  },
  Uri: {
    file: (value: string) => ({
      scheme: "file",
      path: value,
      fsPath: value
    })
  }
}));

import {
  createLocalMirrorLocalChangeMonitor,
  LOCAL_MIRROR_CHANGE_DEBOUNCE_MS
} from "../../src/extension/localMirrorLocalChangeMonitor";
import { LocalMirrorManifest } from "../../src/extension/localMirrorService";
import { LocalMirrorScmState } from "../../src/extension/localMirrorSourceControl";
import { hashLocalMirrorBody } from "../../src/extension/localMirrorScmSupport";

function manifest(body: string): LocalMirrorManifest {
  return {
    version: 1,
    cases: {
      "501": {
        caseId: 501,
        planId: 100,
        localPath: ".kiwi-mirror/plans/100 - Regression/cases/501 - Login works.md",
        downloadedVersionToken: "history_id:1",
        downloadedContentHash: hashLocalMirrorBody(body),
        lastDownloadedAt: "2026-05-02T00:00:00.000Z"
      }
    }
  };
}

describe("localMirrorLocalChangeMonitor", () => {
  it("reflects local file changes into SCM without remote access", async () => {
    vi.useFakeTimers();
    let state: LocalMirrorScmState | undefined;
    const monitor = createLocalMirrorLocalChangeMonitor({
      getWorkspaceFolders: () => [{ uri: { fsPath: "/workspace" } }],
      readLocalFile: vi.fn(async () => "changed"),
      readManifest: vi.fn(async () => manifest("baseline")),
      findManifestFiles: vi.fn(async () => [
        { scheme: "file", fsPath: "/workspace/.kiwi-mirror/kiwi-mirror.json" } as never
      ]),
      createFileSystemWatcher: () => ({
        onDidChange: () => ({ dispose() {} }),
        onDidCreate: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        dispose() {}
      }),
      getLocalMirrorScmState: () => state,
      setLocalMirrorScmState: (next) => {
        state = next;
      },
      clearLocalMirrorScmState: () => {
        state = undefined;
      },
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle)
    });

    await vi.advanceTimersByTimeAsync(LOCAL_MIRROR_CHANGE_DEBOUNCE_MS);
    expect(state?.resources).toMatchObject([
      {
        caseRef: { id: 501, summary: "Login works" },
        plan: { id: 100, name: "Regression" },
        status: "LocalChanged"
      }
    ]);
    monitor.dispose();
    vi.useRealTimers();
  });

  it("promotes an existing remote change to conflict on local-only refresh", async () => {
    vi.useFakeTimers();
    let state: LocalMirrorScmState | undefined = {
      target: {
        kind: "plan",
        plan: { id: 100, name: "Regression" }
      },
      resources: [
        {
          plan: { id: 100, name: "Regression" },
          caseRef: { id: 501, summary: "Login works" },
          status: "RemoteChanged",
          localPath: "/workspace/.kiwi-mirror/plans/100 - Regression/cases/501 - Login works.md",
          localUri: {
            scheme: "file",
            path: "/workspace/.kiwi-mirror/plans/100 - Regression/cases/501 - Login works.md",
            fsPath: "/workspace/.kiwi-mirror/plans/100 - Regression/cases/501 - Login works.md"
          },
          remoteUri: { scheme: "kiwi-diff", path: "/remote" },
          diffTitle: "Login works"
        }
      ]
    };
    const monitor = createLocalMirrorLocalChangeMonitor({
      getWorkspaceFolders: () => [{ uri: { fsPath: "/workspace" } }],
      readLocalFile: vi.fn(async () => "changed"),
      readManifest: vi.fn(async () => manifest("baseline")),
      findManifestFiles: vi.fn(async () => [
        { scheme: "file", fsPath: "/workspace/.kiwi-mirror/kiwi-mirror.json" } as never
      ]),
      createFileSystemWatcher: () => ({
        onDidChange: () => ({ dispose() {} }),
        onDidCreate: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        dispose() {}
      }),
      getLocalMirrorScmState: () => state,
      setLocalMirrorScmState: (next) => {
        state = next;
      },
      clearLocalMirrorScmState: () => {
        state = undefined;
      },
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle)
    });

    await vi.advanceTimersByTimeAsync(LOCAL_MIRROR_CHANGE_DEBOUNCE_MS);
    expect(state?.resources[0]?.status).toBe("Conflict");
    monitor.dispose();
    vi.useRealTimers();
  });

  it("does not clear state when the manifest cannot be read", async () => {
    vi.useFakeTimers();
    let state: LocalMirrorScmState | undefined = {
      target: {
        kind: "plan",
        plan: { id: 100, name: "Regression" }
      },
      resources: []
    };
    const monitor = createLocalMirrorLocalChangeMonitor({
      getWorkspaceFolders: () => [{ uri: { fsPath: "/workspace" } }],
      readLocalFile: vi.fn(),
      readManifest: vi.fn(async () => {
        throw new Error("invalid");
      }),
      findManifestFiles: vi.fn(async () => [
        { scheme: "file", fsPath: "/workspace/.kiwi-mirror/kiwi-mirror.json" } as never
      ]),
      createFileSystemWatcher: () => ({
        onDidChange: () => ({ dispose() {} }),
        onDidCreate: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        dispose() {}
      }),
      getLocalMirrorScmState: () => state,
      setLocalMirrorScmState: (next) => {
        state = next;
      },
      clearLocalMirrorScmState: () => {
        state = undefined;
      },
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle)
    });

    await vi.advanceTimersByTimeAsync(LOCAL_MIRROR_CHANGE_DEBOUNCE_MS);
    expect(state).toBeDefined();
    monitor.dispose();
    vi.useRealTimers();
  });
});
