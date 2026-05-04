import * as vscode from "vscode";
import { KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";
import { CaseMetadataEditorController } from "./caseMetadataEditorController";
import {
  resolveCaseCreateTarget,
  resolveCaseDuplicateTarget,
  resolveCaseMetadataTarget
} from "./commandTargetResolvers";

export function registerCaseMetadataCommands(args: {
  metadataEditorController: CaseMetadataEditorController;
}): vscode.Disposable[] {
  const { metadataEditorController } = args;

  return [
    vscode.commands.registerCommand("kiwi.editCaseMetadata", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseMetadataTarget(target);
      if (!resolved) {
        return undefined;
      }

      const panel = await metadataEditorController.open(resolved);
      return panel.title;
    }),
    vscode.commands.registerCommand("kiwi.createCase", async (target?: KiwiPlansTreeNode) => {
      const resolved = resolveCaseCreateTarget(target);
      if (!resolved) {
        return undefined;
      }

      const panel = await metadataEditorController.open(resolved);
      return panel.title;
    }),
    vscode.commands.registerCommand("kiwi.duplicateCase", async (target?: KiwiPlansTreeNode) => {
      const resolved = await resolveCaseDuplicateTarget(target);
      if (!resolved) {
        return undefined;
      }

      const panel = await metadataEditorController.open(resolved);
      return panel.title;
    })
  ];
}
