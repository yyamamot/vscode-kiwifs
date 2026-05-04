import * as vscode from "vscode";
import { caseFileName, parseNumericPrefix, planDirectoryName } from "../domain/pathCodec";
import { type KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";

export function activeCaseNode(): Extract<KiwiPlansTreeNode, { kind: "case" }> | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  if (!uri || !isCaseDocumentUri(uri)) {
    return undefined;
  }

  const match = /^\/plans\/([^/]+)\/cases\/([^/]+)$/.exec(uri.path);
  if (!match) {
    return undefined;
  }

  const planId = parseNumericPrefix(match[1]);
  const caseId = parseNumericPrefix(match[2]);
  if (planId === undefined || caseId === undefined) {
    return undefined;
  }

  return {
    kind: "case",
    plan: { id: planId, name: parseSummaryFromSegment(match[1]) },
    caseRef: { id: caseId, summary: parseSummaryFromFile(match[2]) }
  };
}

export function caseDiffUri(
  side: "local" | "remote" | "history" | "latest",
  plan: { id: number; name: string },
  caseRef: { id: number; summary: string },
  requestId: string
): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-diff:/${side}/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/cases/${encodeURIComponent(`${caseRef.id} - ${caseRef.summary}.md`)}?requestId=${encodeURIComponent(requestId)}`
  );
}

export function caseHistoryUri(
  plan: { id: number; name: string },
  caseRef: { id: number; summary: string }
): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-history:/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/cases/${encodeURIComponent(`Case ${caseRef.id} - ${caseRef.summary} history.md`)}`
  );
}

export function planInfoUri(plan: { id: number; name: string }): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-plan-info:/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/plan.md`
  );
}

export function localMirrorDiffUri(
  side: "local" | "remote",
  plan: { id: number; name: string },
  caseRef: { id: number; summary: string },
  requestId: string
): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-diff:/mirror-${side}/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/cases/${encodeURIComponent(`${caseRef.id} - ${caseRef.summary}.md`)}?requestId=${encodeURIComponent(requestId)}`
  );
}

export function caseAttachmentsUri(
  plan: { id: number; name: string },
  caseRef: { id: number; summary: string }
): vscode.Uri {
  return vscode.Uri.parse(
    `kiwi-attachments:/plans/${encodeURIComponent(`${plan.id} - ${plan.name}`)}/cases/${encodeURIComponent(`${caseRef.id} - ${caseRef.summary}.md`)}`
  );
}

export function isCaseDocumentUri(uri: vscode.Uri): boolean {
  return uri.scheme === "kiwi" && /^\/plans\/[^/]+\/cases\/.+\.md$/.test(uri.path);
}

export function parseCaseDocumentIdentity(
  uri: vscode.Uri
): { planId: number; caseId: number; summary: string } | undefined {
  if (!isCaseDocumentUri(uri)) {
    return undefined;
  }

  const match = /^\/plans\/([^/]+)\/cases\/([^/]+)$/.exec(uri.path);
  if (!match) {
    return undefined;
  }

  const planId = parseNumericPrefix(match[1]);
  const caseId = parseNumericPrefix(match[2]);
  if (planId === undefined || caseId === undefined) {
    return undefined;
  }

  return {
    planId,
    caseId,
    summary: parseSummaryFromFile(match[2])
  };
}

export function renderLocalMirrorDiffTitle(summary: string): string {
  return `${summary} (Local Mirror ↔ Remote)`;
}

function parseSummaryFromSegment(value: string): string {
  return value.replace(/^\d+\s*-\s*/, "").trim();
}

function parseSummaryFromFile(value: string): string {
  return value.replace(/^\d+\s*-\s*/, "").replace(/\.md$/i, "").trim();
}
