import * as vscode from "vscode";
import { createAdapter } from "../adapter/createAdapter";
import { resolveKiwiConfig } from "../config/resolveConfig";
import { deriveVersionToken } from "../domain/versionToken";
import { caseFileName, planDirectoryName } from "../domain/pathCodec";
import { KiwiCaseBody } from "../types";
import { KiwiFileSystemProvider } from "../provider/KiwiFileSystemProvider";
import { buildCaseBrowserUri } from "./buildCaseBrowserUri";
import { buildPlanBrowserUri } from "./buildPlanBrowserUri";
import { caseDocumentUri, type KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";
import { activeCaseNode, isCaseDocumentUri } from "./extensionUris";
import { humanMessage } from "./extensionRuntimeSupport";
import { type MetadataEditorTarget } from "./caseMetadataEditorController";

export async function resolveCaseInfoTarget(
  target: KiwiPlansTreeNode | undefined,
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>
): Promise<
  | {
      plan: { id: number; name: string };
      caseRef: { id: number; summary: string };
      caseData: Awaited<ReturnType<ReturnType<typeof createAdapter>["getCase"]>>;
      versionToken: string;
    }
  | undefined
> {
  if (!target || target.kind !== "case") {
    return undefined;
  }

  try {
    const { adapter, config } = await clientFactory();
    const [caseData, history] = await Promise.all([
      adapter.getCase(config, target.caseRef.id, target.plan.id),
      adapter.getCaseHistory(config, target.caseRef.id)
    ]);
    return {
      plan: target.plan,
      caseRef: target.caseRef,
      caseData,
      versionToken: deriveVersionToken(history)
    };
  } catch (error) {
    void vscode.window.showErrorMessage(humanMessage(error));
    return undefined;
  }
}

export async function resolveCaseMetadataTarget(
  target: KiwiPlansTreeNode | undefined
): Promise<MetadataEditorTarget | undefined> {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }
  return {
    mode: "edit",
    plan: resolvedTarget.plan,
    caseRef: resolvedTarget.caseRef
  };
}

export function resolveCaseCreateTarget(
  target: KiwiPlansTreeNode | undefined
): MetadataEditorTarget | undefined {
  if (!target || target.kind !== "plan") {
    void vscode.window.showInformationMessage("Select a Kiwi plan first.");
    return undefined;
  }
  return {
    mode: "create",
    plan: target.plan
  };
}

export function resolveAddExistingCaseToPlanTarget(
  target: KiwiPlansTreeNode | undefined
): Extract<KiwiPlansTreeNode, { kind: "plan" }> | undefined {
  if (!target || target.kind !== "plan") {
    void vscode.window.showInformationMessage("Select a Kiwi plan first.");
    return undefined;
  }
  return target;
}

export function resolveCaseDuplicateTarget(
  target: KiwiPlansTreeNode | undefined
): MetadataEditorTarget | undefined {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }
  return {
    mode: "duplicate",
    plan: resolvedTarget.plan,
    caseRef: resolvedTarget.caseRef
  };
}

export async function resolveCaseExecutionTarget(
  target: KiwiPlansTreeNode | undefined
): Promise<Extract<KiwiPlansTreeNode, { kind: "case" }> | undefined> {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }
  return resolvedTarget;
}

export async function resolveCaseAttachmentTarget(
  target: KiwiPlansTreeNode | undefined
): Promise<Extract<KiwiPlansTreeNode, { kind: "case" }> | undefined> {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }
  return resolvedTarget;
}

export async function resolvePlanInfoTarget(
  target: KiwiPlansTreeNode | undefined,
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>
): Promise<
  | {
      plan: { id: number; name: string };
      planData: Awaited<ReturnType<ReturnType<typeof createAdapter>["getPlan"]>>;
    }
  | undefined
> {
  if (!target || target.kind !== "plan") {
    void vscode.window.showInformationMessage("Select a Kiwi plan first.");
    return undefined;
  }

  try {
    const { adapter, config } = await clientFactory();
    const planData = await adapter.getPlan(config, target.plan.id);
    return {
      plan: target.plan,
      planData
    };
  } catch (error) {
    void vscode.window.showErrorMessage(humanMessage(error));
    return undefined;
  }
}

export function resolveFreshnessUri(target?: KiwiPlansTreeNode): vscode.Uri | undefined {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  const uri = resolvedTarget
    ? caseDocumentUri(resolvedTarget.plan, resolvedTarget.caseRef)
    : vscode.window.activeTextEditor?.document.uri;
  if (!uri || !isCaseDocumentUri(uri)) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }
  return uri;
}

export async function resolveCaseDiffTarget(
  target: KiwiPlansTreeNode | undefined,
  provider: KiwiFileSystemProvider,
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>
): Promise<
  | {
      plan: { id: number; name: string };
      caseRef: { id: number; summary: string };
      caseData: KiwiCaseBody;
      localBody: string;
      remoteBody: string;
    }
  | undefined
> {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }

  try {
    const { adapter, config } = await clientFactory();
    const caseData = await adapter.getCaseBody(
      config,
      resolvedTarget.caseRef.id,
      resolvedTarget.plan.id
    );
    return {
      plan: resolvedTarget.plan,
      caseRef: resolvedTarget.caseRef,
      caseData,
      localBody: await resolveLocalDiffBody(resolvedTarget, provider),
      remoteBody: caseData.text
    };
  } catch (error) {
    void vscode.window.showErrorMessage(humanMessage(error));
    return undefined;
  }
}

export async function resolveCaseBrowserTarget(
  target: KiwiPlansTreeNode | undefined,
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>
): Promise<{ uri: vscode.Uri } | undefined> {
  const resolvedTarget = target?.kind === "case" ? target : activeCaseNode();
  if (!resolvedTarget) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }

  try {
    const { config } = await clientFactory();
    return {
      uri: vscode.Uri.parse(buildCaseBrowserUri(config.baseUrl, resolvedTarget.caseRef.id))
    };
  } catch (error) {
    void vscode.window.showErrorMessage(humanMessage(error));
    return undefined;
  }
}

export async function resolvePlanBrowserTarget(
  target: KiwiPlansTreeNode | undefined,
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>
): Promise<{ uri: vscode.Uri } | undefined> {
  if (!target || target.kind !== "plan") {
    void vscode.window.showInformationMessage("Select a Kiwi plan first.");
    return undefined;
  }

  try {
    const { config } = await clientFactory();
    return {
      uri: vscode.Uri.parse(buildPlanBrowserUri(config.baseUrl, target.plan.id))
    };
  } catch (error) {
    void vscode.window.showErrorMessage(humanMessage(error));
    return undefined;
  }
}

async function resolveLocalDiffBody(
  target: Extract<KiwiPlansTreeNode, { kind: "case" }>,
  provider: KiwiFileSystemProvider
): Promise<string> {
  const uri = vscode.Uri.parse(
    `kiwi:/plans/${planDirectoryName(target.plan)}/cases/${caseFileName(target.caseRef)}`
  );
  const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
  if (openDocument) {
    return openDocument.getText();
  }

  const cached = provider.getCachedCaseDocument(uri);
  if (cached) {
    return cached.body;
  }

  return Buffer.from(await provider.readFile(uri)).toString("utf8");
}
