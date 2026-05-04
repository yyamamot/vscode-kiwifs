import * as vscode from "vscode";
import { createAdapter } from "../adapter/createAdapter";
import { resolveKiwiConfig } from "../config/resolveConfig";
import { KiwiFileSystemProvider } from "../provider/KiwiFileSystemProvider";
import { KiwiPlansTreeDataProvider, KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";
import { closeOpenedCaseDocumentsForDeletedCase } from "./caseDocumentLifecycle";
import { humanMessage } from "./extensionRuntimeSupport";
import { localize } from "./l10n";

type ClientFactory = () => Promise<{
  adapter: ReturnType<typeof createAdapter>;
  config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
}>;

export function registerCaseDeletionCommands(args: {
  clientFactory: ClientFactory;
  provider: KiwiFileSystemProvider;
  treeDataProvider: KiwiPlansTreeDataProvider;
}): vscode.Disposable[] {
  const { clientFactory, provider, treeDataProvider } = args;

  return [
    vscode.commands.registerCommand(
      "kiwi.deleteCase",
      async (target?: KiwiPlansTreeNode, injectedConfirmation?: boolean) => {
        const resolved = target?.kind === "case" ? target : undefined;
        if (!resolved) {
          void vscode.window.showInformationMessage("Select a Kiwi case first.");
          return undefined;
        }

        try {
          const { adapter, config } = await clientFactory();
          const proceed =
            injectedConfirmation ??
            ((await vscode.window.showWarningMessage(
              localize(
                "Delete test case {0} - {1}? This deletes the case in Kiwi TCMS, closes open Case Documents, and discards unsaved changes.",
                resolved.caseRef.id,
                resolved.caseRef.summary
              ),
              { modal: true },
              localize("Delete")
            )) === localize("Delete"));
          if (!proceed) {
            return {
              planId: resolved.plan.id,
              caseId: resolved.caseRef.id,
              summary: resolved.caseRef.summary,
              cancelled: true
            };
          }

          await adapter.deleteCase(config, resolved.caseRef.id);
          await closeOpenedCaseDocumentsForDeletedCase(provider, resolved.caseRef.id);
          provider.refreshListings();
          treeDataProvider.clearCaseFreshness(resolved.caseRef.id);
          treeDataProvider.refresh();
          void vscode.window.showInformationMessage(localize("Deleted the test case."));
          return {
            planId: resolved.plan.id,
            caseId: resolved.caseRef.id,
            summary: resolved.caseRef.summary
          };
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    )
  ];
}
