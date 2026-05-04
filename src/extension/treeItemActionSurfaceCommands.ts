import * as vscode from "vscode";
import { KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";
import { TreeItemActionSurfaceController } from "./treeItemActionSurfaceController";

export function registerTreeItemActionSurfaceCommands(args: {
  controller: TreeItemActionSurfaceController;
}): vscode.Disposable[] {
  const { controller } = args;

  return [
    vscode.commands.registerCommand("kiwi.showTreeItemActions", async (target?: KiwiPlansTreeNode) => {
      const panel = await controller.open(target);
      return panel?.title;
    }),
    vscode.commands.registerCommand("kiwi.showPlanTreeItemActions", async (target?: KiwiPlansTreeNode) => {
      const panel = await controller.open(target);
      return panel?.title;
    }),
    vscode.commands.registerCommand("kiwi.showCaseTreeItemActions", async (target?: KiwiPlansTreeNode) => {
      const panel = await controller.open(target);
      return panel?.title;
    }),
    vscode.commands.registerCommand("kiwi.__test.getTreeItemActionSurfaceState", async (target?: KiwiPlansTreeNode) => {
      return controller.getState(target);
    })
  ];
}
