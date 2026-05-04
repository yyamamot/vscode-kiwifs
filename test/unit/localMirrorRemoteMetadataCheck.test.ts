import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    parse: (value: string) => {
      const separatorIndex = value.indexOf(":");
      return {
        scheme: separatorIndex >= 0 ? value.slice(0, separatorIndex) : "file",
        path: separatorIndex >= 0 ? value.slice(separatorIndex + 1) : value
      };
    }
  }
}));

import { createLocalMirrorRemoteMetadataChecker } from "../../src/extension/localMirrorRemoteMetadataCheck";
import { LocalMirrorManifest } from "../../src/extension/localMirrorService";
import { LocalMirrorScmState } from "../../src/extension/localMirrorSourceControl";
import { hashLocalMirrorBody } from "../../src/extension/localMirrorScmSupport";

function manifest(input: { baselineBody: string; versionToken: string }): LocalMirrorManifest {
  return {
    version: 1,
    cases: {
      "501": {
        caseId: 501,
        planId: 100,
        localPath: ".kiwi-mirror/plans/100 - Regression/cases/501 - Login works.md",
        downloadedVersionToken: input.versionToken,
        downloadedContentHash: hashLocalMirrorBody(input.baselineBody),
        lastDownloadedAt: "2026-05-02T00:00:00.000Z"
      }
    }
  };
}

function state(status: "LocalChanged" | "RemoteChanged" | "Conflict"): LocalMirrorScmState {
  return {
    target: {
      kind: "plan",
      plan: { id: 100, name: "Regression" }
    },
    resources: [
      {
        plan: { id: 100, name: "Regression" },
        caseRef: { id: 501, summary: "Login works" },
        status,
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
}

describe("localMirrorRemoteMetadataCheck", () => {
  it("promotes a local change to conflict when remote metadata changed", async () => {
    let currentState: LocalMirrorScmState | undefined = state("LocalChanged");
    const checker = createLocalMirrorRemoteMetadataChecker({
      workspaceRoot: "/workspace",
      clientFactory: async () => ({
        config: {} as never,
        adapter: {
          getCaseHistory: vi.fn(async () => [{ historyId: "2" }])
        } as never
      }),
      readLocalFile: vi.fn(async () => "changed"),
      readManifest: vi.fn(async () => manifest({ baselineBody: "baseline", versionToken: "history_id:1" })),
      getLocalMirrorScmState: () => currentState,
      setLocalMirrorScmState: (next) => {
        currentState = next;
      },
      clearLocalMirrorScmState: () => {
        currentState = undefined;
      },
      now: () => 1000
    });

    await checker.checkCurrentLocalChangedResources();
    expect(currentState?.resources[0]?.status).toBe("Conflict");
  });

  it("clears resolved local changes when local and remote match the manifest", async () => {
    let currentState: LocalMirrorScmState | undefined = state("LocalChanged");
    const checker = createLocalMirrorRemoteMetadataChecker({
      workspaceRoot: "/workspace",
      clientFactory: async () => ({
        config: {} as never,
        adapter: {
          getCaseHistory: vi.fn(async () => [{ historyId: "1" }])
        } as never
      }),
      readLocalFile: vi.fn(async () => "baseline"),
      readManifest: vi.fn(async () => manifest({ baselineBody: "baseline", versionToken: "history_id:1" })),
      getLocalMirrorScmState: () => currentState,
      setLocalMirrorScmState: (next) => {
        currentState = next;
      },
      clearLocalMirrorScmState: () => {
        currentState = undefined;
      },
      now: () => 1000
    });

    await checker.checkCurrentLocalChangedResources();
    expect(currentState).toBeUndefined();
  });

  it("respects cooldown for automatic local changed checks", async () => {
    let currentState: LocalMirrorScmState | undefined = state("LocalChanged");
    const getCaseHistory = vi.fn(async () => [{ historyId: "2" }]);
    const checker = createLocalMirrorRemoteMetadataChecker({
      workspaceRoot: "/workspace",
      clientFactory: async () => ({
        config: {} as never,
        adapter: {
          getCaseHistory
        } as never
      }),
      readLocalFile: vi.fn(async () => "changed"),
      readManifest: vi.fn(async () => manifest({ baselineBody: "baseline", versionToken: "history_id:1" })),
      getLocalMirrorScmState: () => currentState,
      setLocalMirrorScmState: (next) => {
        currentState = next;
      },
      clearLocalMirrorScmState: () => {
        currentState = undefined;
      },
      now: () => 1000
    });

    await checker.checkCurrentLocalChangedResources();
    currentState = state("LocalChanged");
    await checker.checkCurrentLocalChangedResources();
    expect(getCaseHistory).toHaveBeenCalledTimes(1);
  });
});
