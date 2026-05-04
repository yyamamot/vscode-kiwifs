import * as vscode from "vscode";
import { KiwiFileSystemProvider } from "../provider/KiwiFileSystemProvider";
import { caseDocumentUri, KiwiPlansTreeDataProvider } from "./KiwiPlansTreeDataProvider";
import { parseCaseDocumentIdentity } from "./extensionUris";
import { getTabUriString } from "./extensionRuntimeSupport";
import { type MetadataEditorSaveResult } from "./caseMetadataEditorController";
import { type ExecutionResultSaveResult } from "./executionResultController";
import { localize } from "./l10n";

export async function handleCaseMetadataEditorSaved(args: {
  caseProvider: KiwiFileSystemProvider;
  treeDataProvider: KiwiPlansTreeDataProvider;
  result: MetadataEditorSaveResult;
}): Promise<void> {
  const { caseProvider, treeDataProvider, result } = args;
  if (result.kind === "created") {
    caseProvider.refreshListings();
    treeDataProvider.refresh();
    await openCreatedCaseDocument(result);
    void vscode.window.showInformationMessage(
      result.mode === "duplicate" ? "Case duplicated." : "Case created."
    );
    return;
  }

  let message = "Metadata saved.";

  if (result.changedFields.includes("summary")) {
    caseProvider.refreshListings();
    treeDataProvider.refresh();
    const reopenOutcome = await reopenOpenedCaseDocumentsAfterSummaryChange(result);
    if (reopenOutcome === "reopened") {
      message = "Metadata saved. Opened case document was reopened with the updated summary.";
    } else if (reopenOutcome === "dirty") {
      message =
        "Metadata saved. Opened case document was not reopened because it has unsaved changes.";
    }
  }

  void vscode.window.showInformationMessage(message);
}

export async function handleExecutionResultSaved(result: ExecutionResultSaveResult): Promise<void> {
  void vscode.window.showInformationMessage(
    result.changedFields.length === 0
      ? localize("No execution result changes.")
      : localize("Execution result saved.")
  );
}

export async function closeOpenedCaseDocumentsForDeletedCase(
  provider: KiwiFileSystemProvider,
  caseId: number
): Promise<"closed" | "dirty-closed" | "not-open"> {
  const matchingDocuments = vscode.workspace.textDocuments.filter((document) => {
    const identity = parseCaseDocumentIdentity(document.uri);
    return identity?.caseId === caseId;
  });
  if (matchingDocuments.length === 0) {
    return "not-open";
  }

  let closedDirty = false;
  for (const document of matchingDocuments) {
    provider.releaseCaseDocument(document.uri);
    if (!document.isDirty) {
      continue;
    }
    closedDirty = true;
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: true
    });
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }

  const targetUris = new Set(matchingDocuments.map((document) => document.uri.toString()));
  const tabTargets = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter((tab) => {
      const tabUri = getTabUriString(tab);
      return tabUri ? targetUris.has(tabUri) : false;
    })
  );
  if (tabTargets.length > 0) {
    await vscode.window.tabGroups.close(tabTargets, true);
  }

  return closedDirty ? "dirty-closed" : "closed";
}

async function reopenOpenedCaseDocumentsAfterSummaryChange(
  result: Extract<MetadataEditorSaveResult, { kind: "updated" }>
): Promise<"reopened" | "dirty" | "not-open"> {
  const matchingDocuments = vscode.workspace.textDocuments.filter((document) => {
    const identity = parseCaseDocumentIdentity(document.uri);
    return identity?.planId === result.planId && identity.caseId === result.caseId;
  });
  if (matchingDocuments.length === 0) {
    return "not-open";
  }
  if (matchingDocuments.some((document) => document.isDirty)) {
    return "dirty";
  }

  const oldUris = [...new Set(matchingDocuments.map((document) => document.uri.toString()))];
  const newUri = caseDocumentUri(
    { id: result.planId, name: result.planName },
    {
      id: result.caseId,
      summary: result.updatedCase.summary
    }
  );
  const reopenedDocument = await vscode.workspace.openTextDocument(newUri);

  for (const group of vscode.window.tabGroups.all) {
    const groupHasOldTab = group.tabs.some((tab) => {
      const tabUri = getTabUriString(tab);
      return tabUri ? oldUris.includes(tabUri) : false;
    });
    if (!groupHasOldTab) {
      continue;
    }
    await vscode.window.showTextDocument(reopenedDocument, {
      viewColumn: group.viewColumn,
      preview: false,
      preserveFocus: true
    });
  }

  const tabTargets = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter((tab) => {
      const tabUri = getTabUriString(tab);
      return tabUri ? oldUris.includes(tabUri) : false;
    })
  );
  if (tabTargets.length > 0) {
    await vscode.window.tabGroups.close(tabTargets, true);
  }

  return "reopened";
}

async function openCreatedCaseDocument(
  result: Extract<MetadataEditorSaveResult, { kind: "created" }>
): Promise<void> {
  const uri = caseDocumentUri(
    { id: result.planId, name: result.planName },
    {
      id: result.createdCase.id,
      summary: result.createdCase.summary
    }
  );
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    preview: false
  });
}
