import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  l10n: {
    t: (message: string) => message
  },
  Uri: {
    file: (value: string) => ({
      scheme: "file",
      path: value,
      fsPath: value
    }),
    parse: (value: string) => {
      const separatorIndex = value.indexOf(":");
      const scheme = separatorIndex >= 0 ? value.slice(0, separatorIndex) : "file";
      const path = separatorIndex >= 0 ? value.slice(separatorIndex + 1) : value;
      return {
        scheme,
        path
      };
    }
  }
}));

import {
  createKiwiLocalMirrorSourceControl,
  KIWI_LOCAL_MIRROR_CONFLICT_CONTEXT,
  KIWI_LOCAL_MIRROR_LOCAL_CHANGES_CONTEXT,
  KIWI_LOCAL_MIRROR_REMOTE_CHANGES_CONTEXT
} from "../../src/extension/localMirrorSourceControl";

describe("localMirrorSourceControl", () => {
  it("groups SCM resources and tracks badge count", () => {
    const groups: Array<{ id: string; label: string; resourceStates: unknown[] }> = [];
    const sourceControl = createKiwiLocalMirrorSourceControl({
      createSourceControl() {
        return {
          count: 0,
          inputBox: {
            visible: true
          },
          createResourceGroup(id: string, label: string) {
            const group = {
              id,
              label,
              resourceStates: [] as unknown[]
            };
            groups.push(group);
            return group;
          },
          dispose() {}
        };
      }
    });

    sourceControl.setState({
      target: {
        kind: "plan",
        plan: { id: 100, name: "Regression" }
      },
      resources: [
        {
          plan: { id: 100, name: "Regression" },
          caseRef: { id: 501, summary: "Login works" },
          status: "LocalChanged",
          localPath: "/tmp/501.md",
          localUri: { scheme: "file", path: "/tmp/501.md", fsPath: "/tmp/501.md" },
          remoteUri: { scheme: "kiwi-diff", path: "/mirror-remote/501" },
          diffTitle: "Login works (Local Mirror ↔ Remote)"
        },
        {
          plan: { id: 100, name: "Regression" },
          caseRef: { id: 502, summary: "Password reset works" },
          status: "RemoteChanged",
          localPath: "/tmp/502.md",
          localUri: { scheme: "file", path: "/tmp/502.md", fsPath: "/tmp/502.md" },
          remoteUri: { scheme: "kiwi-diff", path: "/mirror-remote/502" },
          diffTitle: "Password reset works (Local Mirror ↔ Remote)"
        },
        {
          plan: { id: 100, name: "Regression" },
          caseRef: { id: 503, summary: "Conflict case" },
          status: "Conflict",
          localPath: "/tmp/503.md",
          localUri: { scheme: "file", path: "/tmp/503.md", fsPath: "/tmp/503.md" },
          remoteUri: { scheme: "kiwi-diff", path: "/mirror-remote/503" },
          diffTitle: "Conflict case (Local Mirror ↔ Remote)"
        }
      ]
    });

    expect(sourceControl.sourceControl.inputBox.visible).toBe(false);
    expect(sourceControl.sourceControl.count).toBe(3);
    expect(groups.find((group) => group.id === "changes")?.label).toBe("Local Changes");
    expect(groups.find((group) => group.id === "remoteChanged")?.label).toBe("Kiwi Changes");
    expect(groups.find((group) => group.id === "conflicts")?.label).toBe("Conflicts");
    expect(groups.find((group) => group.id === "changes")?.resourceStates).toHaveLength(1);
    expect(groups.find((group) => group.id === "remoteChanged")?.resourceStates).toHaveLength(1);
    expect(groups.find((group) => group.id === "conflicts")?.resourceStates).toHaveLength(1);

    const changeState = groups.find((group) => group.id === "changes")?.resourceStates[0] as {
      contextValue: string;
      command: { command: string };
    };
    const remoteState = groups.find((group) => group.id === "remoteChanged")?.resourceStates[0] as {
      contextValue: string;
      command: { command: string };
    };
    const conflictState = groups.find((group) => group.id === "conflicts")?.resourceStates[0] as {
      contextValue: string;
      command: { command: string };
    };
    expect(changeState.contextValue).toBe(KIWI_LOCAL_MIRROR_LOCAL_CHANGES_CONTEXT);
    expect(remoteState.contextValue).toBe(KIWI_LOCAL_MIRROR_REMOTE_CHANGES_CONTEXT);
    expect(conflictState.contextValue).toBe(KIWI_LOCAL_MIRROR_CONFLICT_CONTEXT);
    expect(changeState.command.command).toBe("kiwi.openLocalMirrorScmDiff");
    expect(remoteState.command.command).toBe("kiwi.openLocalMirrorScmDiff");
    expect(conflictState.command.command).toBe("kiwi.openLocalMirrorScmDiff");

    sourceControl.clear();
    expect(sourceControl.sourceControl.count).toBe(0);
    expect(groups.every((group) => group.resourceStates.length === 0)).toBe(true);
    expect(sourceControl.getState()).toBeUndefined();
  });

  it("extracts SCM resources from resource groups and states", () => {
    const groups: Array<{ id: string; label: string; resourceStates: unknown[] }> = [];
    const sourceControl = createKiwiLocalMirrorSourceControl({
      createSourceControl() {
        return {
          count: 0,
          inputBox: {
            visible: true
          },
          createResourceGroup(id: string, label: string) {
            const group = {
              id,
              label,
              resourceStates: [] as unknown[]
            };
            groups.push(group);
            return group;
          },
          dispose() {}
        };
      }
    });

    sourceControl.setState({
      target: {
        kind: "case",
        plan: { id: 100, name: "Regression" },
        caseRef: { id: 501, summary: "Login works" }
      },
      resources: [
        {
          plan: { id: 100, name: "Regression" },
          caseRef: { id: 501, summary: "Login works" },
          status: "LocalChanged",
          localPath: "/tmp/501.md",
          localUri: { scheme: "file", path: "/tmp/501.md", fsPath: "/tmp/501.md" },
          remoteUri: { scheme: "kiwi-diff", path: "/mirror-remote/501" },
          diffTitle: "Login works (Local Mirror ↔ Remote)"
        }
      ]
    });

    const fromGroup = sourceControl.getResourcesFromCommandArgs([
      groups.find((group) => group.id === "changes")
    ]);
    expect(fromGroup).toHaveLength(1);
    expect(fromGroup?.[0]?.caseRef.id).toBe(501);

    const fromState = sourceControl.getResourcesFromCommandArgs([
      (groups.find((group) => group.id === "changes")?.resourceStates ?? [])[0]
    ]);
    expect(fromState).toHaveLength(1);
    expect(fromState?.[0]?.status).toBe("LocalChanged");
  });
});
