import * as vscode from "vscode";
import { KiwiPlan, PlanCaseRef } from "../types";

export const KIWI_LOCAL_MIRROR_SOURCE_CONTROL_ID = "kiwi-local-mirror-compare";
export const KIWI_LOCAL_MIRROR_SOURCE_CONTROL_LABEL = "Kiwi Local Mirror Compare";
export const KIWI_LOCAL_MIRROR_LOCAL_CHANGES_CONTEXT = "kiwi.localChanged";
export const KIWI_LOCAL_MIRROR_REMOTE_CHANGES_CONTEXT = "kiwi.remoteChanged";
export const KIWI_LOCAL_MIRROR_CONFLICT_CONTEXT = "kiwi.conflict";

export type LocalMirrorScmResourceStatus =
  | "LocalChanged"
  | "RemoteChanged"
  | "Conflict";

export type LocalMirrorScmSnapshotTarget =
  | {
      kind: "case";
      plan: KiwiPlan;
      caseRef: PlanCaseRef;
    }
  | {
      kind: "plan";
      plan: KiwiPlan;
    };

export interface UriLike {
  scheme: string;
  path: string;
  fsPath?: string;
}

export interface LocalMirrorScmResource {
  plan: KiwiPlan;
  caseRef: PlanCaseRef;
  status: LocalMirrorScmResourceStatus;
  localPath: string;
  localUri: UriLike;
  remoteUri: UriLike;
  diffTitle: string;
}

export interface LocalMirrorScmState {
  target: LocalMirrorScmSnapshotTarget;
  resources: readonly LocalMirrorScmResource[];
}

type LocalMirrorScmGroupId = "changes" | "remoteChanged" | "conflicts";

interface LocalMirrorScmResourceState extends vscode.SourceControlResourceState {
  contextValue: string;
  localMirrorResource: LocalMirrorScmResource;
}

interface SourceControlResourceGroupLike {
  id?: string;
  label?: string;
  resourceStates: unknown[];
}

interface SourceControlLike {
  count: number;
  inputBox: {
    visible: boolean;
  };
  createResourceGroup(id: string, label: string): SourceControlResourceGroupLike;
  dispose(): void;
}

interface ScmNamespaceLike {
  createSourceControl(id: string, label: string): SourceControlLike;
}

function createNoopSourceControl(): SourceControlLike {
  return {
    count: 0,
    inputBox: {
      visible: false
    },
    createResourceGroup(id: string, label: string) {
      return {
        id,
        label,
        resourceStates: []
      };
    },
    dispose() {}
  };
}

function toVscodeUri(uri: UriLike): vscode.Uri {
  return uri.scheme === "file"
    ? vscode.Uri.file(uri.fsPath ?? uri.path)
    : vscode.Uri.parse(`${uri.scheme}:${uri.path}`);
}

function buildResourceState(resource: LocalMirrorScmResource): LocalMirrorScmResourceState {
  const contextValue =
    resource.status === "LocalChanged"
      ? KIWI_LOCAL_MIRROR_LOCAL_CHANGES_CONTEXT
      : resource.status === "RemoteChanged"
        ? KIWI_LOCAL_MIRROR_REMOTE_CHANGES_CONTEXT
        : KIWI_LOCAL_MIRROR_CONFLICT_CONTEXT;
  const statusLabel =
    resource.status === "LocalChanged"
      ? "modified locally"
      : resource.status === "RemoteChanged"
        ? "remote changed"
        : "conflict";

  return {
    resourceUri: toVscodeUri(resource.localUri),
    contextValue,
    localMirrorResource: resource,
    command: {
      command: "kiwi.openLocalMirrorScmDiff",
      title: resource.diffTitle,
      arguments: [
        resource
      ]
    },
    decorations: {
      tooltip: `${statusLabel}: ${resource.caseRef.id} - ${resource.caseRef.summary}`
    }
  };
}

export function createKiwiLocalMirrorSourceControl(scmNamespace?: ScmNamespaceLike) {
  let currentState: LocalMirrorScmState | undefined;
  const resolvedScmNamespace =
    scmNamespace ??
    ("scm" in vscode
      ? ((vscode as { scm?: ScmNamespaceLike }).scm ?? undefined)
      : undefined);
  const sourceControl =
    resolvedScmNamespace?.createSourceControl(
      KIWI_LOCAL_MIRROR_SOURCE_CONTROL_ID,
      KIWI_LOCAL_MIRROR_SOURCE_CONTROL_LABEL
    ) ?? createNoopSourceControl();
  sourceControl.inputBox.visible = false;

  const changesGroup = sourceControl.createResourceGroup("changes", "Local Changes");
  const remoteChangedGroup = sourceControl.createResourceGroup("remoteChanged", "Remote Changes");
  const conflictsGroup = sourceControl.createResourceGroup("conflicts", "Conflicts");

  const getResourcesForGroup = (groupId: LocalMirrorScmGroupId): LocalMirrorScmResource[] => {
    const resources = currentState?.resources ?? [];
    return resources.filter((resource) =>
      groupId === "changes"
        ? resource.status === "LocalChanged"
        : groupId === "remoteChanged"
          ? resource.status === "RemoteChanged"
          : resource.status === "Conflict"
    );
  };

  const collectResourcesFromUnknown = (
    value: unknown,
    collected: Map<string, LocalMirrorScmResource>
  ) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        collectResourcesFromUnknown(entry, collected);
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }

    if (
      "localMirrorResource" in value &&
      value.localMirrorResource &&
      typeof value.localMirrorResource === "object"
    ) {
      const resource = value.localMirrorResource as LocalMirrorScmResource;
      collected.set(`${resource.plan.id}:${resource.caseRef.id}:${resource.status}`, resource);
      return;
    }

    if ("resourceStates" in value && Array.isArray(value.resourceStates)) {
      collectResourcesFromUnknown(value.resourceStates, collected);
      return;
    }

    if ("id" in value && typeof value.id === "string") {
      const groupId = value.id as LocalMirrorScmGroupId;
      if (
        groupId === "changes" ||
        groupId === "remoteChanged" ||
        groupId === "conflicts"
      ) {
        for (const resource of getResourcesForGroup(groupId)) {
          collected.set(`${resource.plan.id}:${resource.caseRef.id}:${resource.status}`, resource);
        }
      }
    }
  };

  const clear = () => {
    currentState = undefined;
    changesGroup.resourceStates = [];
    remoteChangedGroup.resourceStates = [];
    conflictsGroup.resourceStates = [];
    sourceControl.count = 0;
  };

  const setState = (state: LocalMirrorScmState) => {
    currentState = {
      target: state.target,
      resources: [...state.resources]
    };
    changesGroup.resourceStates = state.resources
      .filter((resource) => resource.status === "LocalChanged")
      .map(buildResourceState);
    remoteChangedGroup.resourceStates = state.resources
      .filter((resource) => resource.status === "RemoteChanged")
      .map(buildResourceState);
    conflictsGroup.resourceStates = state.resources
      .filter((resource) => resource.status === "Conflict")
      .map(buildResourceState);
    sourceControl.count = state.resources.length;
  };

  clear();

  return {
    sourceControl,
    clear,
    getState() {
      return currentState
        ? {
            target: currentState.target,
            resources: [...currentState.resources]
          }
        : undefined;
    },
    getResourcesFromCommandArgs(args: readonly unknown[]) {
      const collected = new Map<string, LocalMirrorScmResource>();
      collectResourcesFromUnknown(args, collected);
      return collected.size > 0 ? [...collected.values()] : undefined;
    },
    setState
  };
}
