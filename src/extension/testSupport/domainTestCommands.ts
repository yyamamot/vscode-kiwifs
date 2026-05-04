import * as vscode from "vscode";
import { CaseExecutionBoardController } from "../caseExecutionBoardController";
import { CaseMetadataEditorController, type MetadataEditorMode } from "../caseMetadataEditorController";
import { ExecutionResultController } from "../executionResultController";
import { TestRunDashboardController } from "../testRunDashboardController";
import { regressionCaseNode, regressionPlanNode } from "./testCommandTargets";

export function registerDomainTestCommands(args: {
  caseExecutionBoardController: CaseExecutionBoardController;
  executionResultController: ExecutionResultController;
  testRunDashboardController: TestRunDashboardController;
  metadataEditorController: CaseMetadataEditorController;
}): vscode.Disposable[] {
  const {
    caseExecutionBoardController,
    executionResultController,
    testRunDashboardController,
    metadataEditorController
  } = args;

  return [
    vscode.commands.registerCommand("kiwi.__test.showCaseInfo", async () => {
      const target = regressionCaseNode();
      return vscode.commands.executeCommand("kiwi.showCaseInfo", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.editCaseMetadata", async () => {
      const target = regressionCaseNode();
      return vscode.commands.executeCommand("kiwi.editCaseMetadata", target);
    }),
    vscode.commands.registerCommand("kiwi.__test.createCase", async () => {
      const target = regressionPlanNode();
      return vscode.commands.executeCommand("kiwi.createCase", target);
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.addExistingCaseToPlan",
      async (query: string, selectionCaseId?: number, targetPlanId = 100) => {
        const target = regressionPlanNode(targetPlanId);
        return vscode.commands.executeCommand(
          "kiwi.addExistingCaseToPlan",
          target,
          query,
          selectionCaseId
        );
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.removeCaseFromPlan",
      async (
        args: {
          selectionCaseId?: number;
          confirmed?: boolean;
          targetPlanId?: number;
          targetCaseId?: number;
          targetCaseSummary?: string;
        } = {}
      ) => {
        if (args.targetCaseId !== undefined) {
          const target = regressionCaseNode({
            planId: args.targetPlanId,
            caseId: args.targetCaseId,
            summary: args.targetCaseSummary
          });
          return vscode.commands.executeCommand(
            "kiwi.removeCaseFromPlan",
            target,
            undefined,
            args.confirmed
          );
        }
        const targetPlanId = args.targetPlanId ?? 100;
        const target = regressionPlanNode(targetPlanId);
        return vscode.commands.executeCommand(
          "kiwi.removeCaseFromPlanFromPlan",
          target,
          args.selectionCaseId,
          args.confirmed
        );
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.deleteCase",
      async (
        args: {
          confirmed?: boolean;
          targetPlanId?: number;
          targetCaseId?: number;
          targetCaseSummary?: string;
        } = {}
      ) => {
        const target = regressionCaseNode({
          planId: args.targetPlanId,
          caseId: args.targetCaseId,
          summary: args.targetCaseSummary
        });
        return vscode.commands.executeCommand("kiwi.deleteCase", target, args.confirmed);
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.duplicateCase", async () => {
      const target = regressionCaseNode();
      return vscode.commands.executeCommand("kiwi.duplicateCase", target);
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.manageCaseExecutionsAcrossRuns",
      async (caseId = 501, summary = "Login works", planId = 100, planName = "Regression") => {
        const target = regressionCaseNode({ planId, planName, caseId, summary });
        return vscode.commands.executeCommand("kiwi.manageCaseExecutionsAcrossRuns", target);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.getCaseExecutionBoardState",
      async (caseId = 501) => {
        return caseExecutionBoardController.getStateForTest(caseId);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.createCaseExecutionBoardRun",
      async (caseId: number, payload: { planId: number; summary: string; buildId: number; manager: string }) => {
        return caseExecutionBoardController.createRunForTest(caseId, payload);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.addCaseExecutionBoardRun",
      async (caseId: number, runId: number) => {
        return caseExecutionBoardController.addRunForTest(caseId, runId);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.saveCaseExecutionBoardRow",
      async (caseId: number, runId: number, status: string, comment: string) => {
        return caseExecutionBoardController.saveRowForTest(caseId, runId, status, comment);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.openCaseExecutionBoardRow",
      async (caseId: number, runId: number) => {
        return caseExecutionBoardController.openRowForTest(caseId, runId);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.recordCaseExecutionResult",
      async (executionId?: number, caseId = 501, summary = "Login works") => {
        const target = regressionCaseNode({ caseId, summary });
        return vscode.commands.executeCommand(
          "kiwi.recordCaseExecutionResult",
          target,
          executionId
        );
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.getExecutionResultState", async (executionId: number) => {
      return executionResultController.getStateForTest(executionId);
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.submitExecutionResult",
      async (executionId: number, formState) => {
        return executionResultController.submitForTest(executionId, formState);
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.openTestRunDashboard", async () => {
      return vscode.commands.executeCommand("kiwi.openTestRunDashboard");
    }),
    vscode.commands.registerCommand("kiwi.__test.getTestRunDashboardState", async () => {
      return testRunDashboardController.getStateForTest();
    }),
    vscode.commands.registerCommand("kiwi.__test.selectDashboardRun", async (runId: number) => {
      return testRunDashboardController.selectRunForTest(runId);
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.saveDashboardRow",
      async (executionId: number, status: string, comment: string) => {
        return testRunDashboardController.saveRowForTest(executionId, status, comment);
      }
    ),
    vscode.commands.registerCommand("kiwi.__test.openDashboardRow", async (executionId: number) => {
      return testRunDashboardController.openRowForTest(executionId);
    }),
    vscode.commands.registerCommand(
      "kiwi.__test.createDashboardRun",
      async (payload: { summary: string; planId: number; buildId: number; manager: string }) => {
        return testRunDashboardController.createRunForTest(payload);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.addCaseToDashboardRun",
      async (caseId: number) => {
        return testRunDashboardController.addCaseToSelectedRunForTest(caseId);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.bulkUpdateDashboardRows",
      async (executionIds: number[], status: string) => {
        return testRunDashboardController.bulkUpdateForTest(executionIds, status);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.getMetadataEditorState",
      async (identifier = 501, mode: MetadataEditorMode = "edit") => {
        return metadataEditorController.getStateForTest(identifier, mode);
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.__test.submitMetadataEditor",
      async (formState, identifier = 501, mode: MetadataEditorMode = "edit", selectedTemplateId?: string) => {
        return metadataEditorController.submitForTest(identifier, formState, mode, selectedTemplateId);
      }
    )
  ];
}
