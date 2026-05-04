import { createHash } from "node:crypto";
import * as path from "node:path";
import { parseNumericPrefix } from "../domain/pathCodec";
import { KiwiPlan, PlanCaseRef } from "../types";
import { renderLocalMirrorDiffTitle } from "./extensionUris";
import { LocalMirrorManifestEntry } from "./localMirrorService";
import {
  LocalMirrorScmResource,
  LocalMirrorScmResourceStatus,
  LocalMirrorScmSnapshotTarget,
  LocalMirrorScmState,
  UriLike
} from "./localMirrorSourceControl";

export function hashLocalMirrorBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function resolveLocalMirrorEntryTarget(
  entry: LocalMirrorManifestEntry
): { plan: KiwiPlan; caseRef: PlanCaseRef } {
  const localPath = path.normalize(entry.localPath);
  const segments = localPath.split(path.sep);
  const casesIndex = segments.lastIndexOf("cases");
  const caseSegment = casesIndex >= 0 ? segments[casesIndex + 1] : path.basename(localPath);
  const planSegment = casesIndex >= 2 ? segments[casesIndex - 1] : `${entry.planId} - Plan ${entry.planId}`;

  return {
    plan: {
      id: entry.planId,
      name: parseNameSegment(planSegment, `Plan ${entry.planId}`)
    },
    caseRef: {
      id: entry.caseId,
      summary: parseFileSummary(caseSegment, `Case ${entry.caseId}`)
    }
  };
}

export function buildLocalMirrorScmResource(input: {
  entry: LocalMirrorManifestEntry;
  localPath: string;
  status: LocalMirrorScmResourceStatus;
}): LocalMirrorScmResource {
  const { plan, caseRef } = resolveLocalMirrorEntryTarget(input.entry);
  const localUri: UriLike = {
    scheme: "file",
    path: input.localPath,
    fsPath: input.localPath
  };
  const remoteUri: UriLike = {
    scheme: "kiwi-diff",
    path: `/mirror-auto/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/cases/${encodeURIComponent(`${caseRef.id} - ${caseRef.summary}.md`)}`
  };
  return {
    plan,
    caseRef,
    status: input.status,
    localPath: input.localPath,
    localUri,
    remoteUri,
    diffTitle: renderLocalMirrorDiffTitle(caseRef.summary)
  };
}

export function buildFallbackLocalMirrorScmTarget(
  resources: readonly LocalMirrorScmResource[]
): LocalMirrorScmSnapshotTarget | undefined {
  const first = resources[0];
  if (!first) {
    return undefined;
  }
  return {
    kind: "plan",
    plan: first.plan
  };
}

export function sameLocalMirrorCase(
  left: Pick<LocalMirrorScmResource, "plan" | "caseRef">,
  right: Pick<LocalMirrorScmResource, "plan" | "caseRef">
): boolean {
  return left.plan.id === right.plan.id && left.caseRef.id === right.caseRef.id;
}

export function replaceLocalMirrorScmResource(
  state: LocalMirrorScmState,
  nextResource: LocalMirrorScmResource | undefined,
  match: Pick<LocalMirrorScmResource, "plan" | "caseRef">
): LocalMirrorScmState {
  const resources = state.resources.filter((resource) => !sameLocalMirrorCase(resource, match));
  if (nextResource) {
    resources.push(nextResource);
  }
  return {
    ...state,
    resources
  };
}

function parseNameSegment(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const trimmed = value.replace(/^\d+\s*-\s*/, "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function parseFileSummary(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const trimmed = value.replace(/^\d+\s*-\s*/, "").replace(/\.md$/i, "").trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  const id = parseNumericPrefix(value);
  return id !== undefined ? `Case ${id}` : fallback;
}
