import * as vscode from "vscode";
import { JsonlLogger } from "../../logging/jsonlLogger";
import { CaseFilterController } from "../caseFilterController";
import { TestRunFilterController } from "../testRunFilterController";
import { KiwiPlansTreeDataProvider, type KiwiPlansTreeNode } from "../KiwiPlansTreeDataProvider";

export function registerUiReviewTestCommands(args: {
  logger: JsonlLogger;
  caseFilterController: CaseFilterController;
  testRunFilterController: TestRunFilterController;
  treeDataProvider: KiwiPlansTreeDataProvider;
  treeView: vscode.TreeView<KiwiPlansTreeNode>;
  extensionPath: string;
}): vscode.Disposable[] {
  const {
    logger,
    caseFilterController,
    testRunFilterController,
    treeDataProvider,
    treeView
  } = args;

  return [
    vscode.commands.registerCommand("kiwi.__test.getResolvedRuntimeLogDirectory", async () => {
      return logger.getResolvedRuntimeLogDirectory();
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.searchCases",
      async (query: string, selectionCaseId?: number) => {
        return vscode.commands.executeCommand("kiwi.searchCases", query, selectionCaseId);
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.filterCases", async () => {
      return vscode.commands.executeCommand("kiwi.filterCases");
    }),
    vscode.commands.registerCommand("kiwi.__test.filterTestRuns", async () => {
      return vscode.commands.executeCommand("kiwi.filterTestRuns");
    }),
    vscode.commands.registerCommand("kiwi.__test.getCaseFilterState", async () => {
      return caseFilterController.getStateForTest();
    }),
    vscode.commands.registerCommand("kiwi.__test.getCaseFilterHtml", async () => {
      return caseFilterController.getHtmlForTest();
    }),
    vscode.commands.registerCommand("kiwi.__test.captureCaseFilterUiReviewSnapshot", async (reason?: string) => {
      return caseFilterController.captureUiReviewSnapshotForTest(reason);
    }),
    vscode.commands.registerCommand("kiwi.__test.getTestRunFilterState", async () => {
      return testRunFilterController.getStateForTest();
    }),
    vscode.commands.registerCommand("kiwi.__test.getTestRunFilterHtml", async () => {
      return testRunFilterController.getHtmlForTest();
    }),
    vscode.commands.registerCommand("kiwi.__test.captureTestRunFilterUiReviewSnapshot", async (reason?: string) => {
      return testRunFilterController.captureUiReviewSnapshotForTest(reason);
    }),
    vscode.commands.registerCommand("kiwi.__test.submitCaseFilter", async (formState) => {
      return caseFilterController.searchForTest(formState);
    }),
    vscode.commands.registerCommand("kiwi.__test.submitTestRunFilter", async (formState) => {
      return testRunFilterController.searchForTest(formState);
    }),
    vscode.commands.registerCommand("kiwi.__test.openCaseFilterResult", async (caseId: number) => {
      return caseFilterController.openResultForTest(caseId);
    }),
    vscode.commands.registerCommand("kiwi.__test.openTestRunFilterResult", async (runId: number) => {
      return testRunFilterController.openResultForTest(runId);
    }),
    vscode.commands.registerCommand("kiwi.__test.toggleCaseFilterSelection", async (caseId: number, selected: boolean) => {
      return caseFilterController.toggleSelectedForTest(caseId, selected);
    }),
    vscode.commands.registerCommand("kiwi.__test.bulkUpdateCaseFilterStatus", async (caseIds: number[], status: string) => {
      return caseFilterController.bulkUpdateStatusForTest(caseIds, status);
    }),
    vscode.commands.registerCommand("kiwi.__test.bulkAddCaseFilterTags", async (caseIds: number[], tagsInput: string) => {
      return caseFilterController.bulkAddTagsForTest(caseIds, tagsInput);
    }),
    vscode.commands.registerCommand("kiwi.__test.bulkRemoveCaseFilterTags", async (caseIds: number[], tagsInput: string) => {
      return caseFilterController.bulkRemoveTagsForTest(caseIds, tagsInput);
    }),
    vscode.commands.registerCommand("kiwi.__test.getPlanTreeSnapshot", async () => {
      return treeDataProvider.snapshot();
    }),
    vscode.commands.registerCommand("kiwi.__test.revealKiwiPlansTreeItem", async (
      target: { kind: "plan" | "case"; planId: number; caseId?: number },
      options?: { select?: boolean; focus?: boolean; expand?: boolean | number }
    ) => {
      await vscode.commands.executeCommand("workbench.view.explorer");
      await vscode.commands.executeCommand("kiwiPlans.focus");
      const item = await treeDataProvider.findNodeForReview(target);
      if (!item) {
        throw new Error(`Kiwi Plans Tree item was not found: ${JSON.stringify(target)}`);
      }
      await treeView.reveal(item, {
        select: options?.select ?? true,
        focus: options?.focus ?? true,
        expand: options?.expand ?? 1
      });
      return item;
    })
  ];
}
