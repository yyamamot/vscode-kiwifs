import * as vscode from "vscode";
import * as path from "node:path";
import { createAdapter } from "../adapter/createAdapter";
import { resolveKiwiConfig } from "../config/resolveConfig";
import { KiwiFileSystemProvider } from "../provider/KiwiFileSystemProvider";
import { LocalMirrorService } from "./localMirrorService";
import { type LocalMirrorScmResource, type UriLike } from "./localMirrorSourceControl";
import {
  caseDocumentUri,
  KiwiPlansTreeDataProvider,
  type KiwiPlansTreeNode
} from "./KiwiPlansTreeDataProvider";
import { activeCaseNode } from "./extensionUris";

export function resolveMirrorTarget(
  target: KiwiPlansTreeNode | undefined
): Extract<KiwiPlansTreeNode, { kind: "case" }> | undefined {
  const resolved = target?.kind === "case" ? target : activeCaseNode();
  if (!resolved) {
    void vscode.window.showInformationMessage("Open a Kiwi case document or select a case first.");
    return undefined;
  }
  return resolved;
}

export function resolvePlanMirrorTarget(
  target: KiwiPlansTreeNode | undefined
): Extract<KiwiPlansTreeNode, { kind: "plan" }> | undefined {
  if (!target || target.kind !== "plan") {
    void vscode.window.showInformationMessage("Select a Kiwi plan first.");
    return undefined;
  }
  return target;
}

export function createLocalMirrorService(
  clientFactory: () => Promise<{
    adapter: ReturnType<typeof createAdapter>;
    config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
  }>,
  context: vscode.ExtensionContext
): LocalMirrorService | undefined {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showInformationMessage(
      "Open a workspace folder before using local mirror commands."
    );
    return undefined;
  }

  if (
    context.extensionMode === vscode.ExtensionMode.Production &&
    isPathInsideOrEqual(workspaceRoot, context.extensionPath)
  ) {
    void vscode.window.showInformationMessage(
      "The current workspace is the installed extension directory. Open another workspace folder before using local mirror commands."
    );
    return undefined;
  }

  return new LocalMirrorService(clientFactory, workspaceRoot);
}

export function toUriLike(uri: vscode.Uri): UriLike {
  return {
    scheme: uri.scheme,
    path: uri.path,
    fsPath: "fsPath" in uri ? uri.fsPath : undefined
  };
}

export function dedupeLocalMirrorScmResources(
  resources: readonly LocalMirrorScmResource[]
): LocalMirrorScmResource[] {
  const deduped = new Map<string, LocalMirrorScmResource>();
  for (const resource of resources) {
    deduped.set(`${resource.plan.id}:${resource.caseRef.id}:${resource.status}`, resource);
  }
  return [...deduped.values()];
}

export function formatLocalMirrorScmSkippedSummary(action: string, skippedCount: number): string {
  return `${action}: skipped=${skippedCount}`;
}

export async function refreshOpenedCaseDocumentAfterLocalMirrorUpload(
  provider: KiwiFileSystemProvider,
  treeDataProvider: KiwiPlansTreeDataProvider,
  target: Extract<KiwiPlansTreeNode, { kind: "case" }>
): Promise<"refreshed" | "dirty" | "not-open"> {
  const uri = caseDocumentUri(target.plan, target.caseRef);
  const openedDocument = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString()
  );
  if (!openedDocument) {
    return "not-open";
  }
  if (openedDocument.isDirty) {
    return "dirty";
  }

  const previousEditor = vscode.window.activeTextEditor;
  const targetEditor =
    vscode.window.visibleTextEditors.find((editor) => documentUriEquals(editor.document.uri, uri)) ??
    (await vscode.window.showTextDocument(openedDocument, {
      preview: false,
      preserveFocus: false
    }));

  await vscode.window.showTextDocument(targetEditor.document, {
    preview: false,
    preserveFocus: false,
    viewColumn: targetEditor.viewColumn
  });
  await provider.refreshCaseDocument(uri);
  await vscode.commands.executeCommand("workbench.action.files.revert");
  treeDataProvider.clearCaseFreshness(target.caseRef.id);

  if (previousEditor && !documentUriEquals(previousEditor.document.uri, uri)) {
    await vscode.window.showTextDocument(previousEditor.document, {
      preview: false,
      preserveFocus: false,
      viewColumn: previousEditor.viewColumn
    });
  }

  return "refreshed";
}

function isPathInsideOrEqual(targetPath: string, rootPath: string): boolean {
  const target = normalizeComparablePath(targetPath);
  const root = normalizeComparablePath(rootPath);
  const relative = path.relative(root, target);
  return relative === "" || (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeComparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function documentUriEquals(left: vscode.Uri, right: vscode.Uri): boolean {
  return left.toString() === right.toString();
}
