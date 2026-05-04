import * as vscode from "vscode";
import { createAdapter } from "../adapter/createAdapter";
import { resolveKiwiConfig } from "../config/resolveConfig";
import { KiwiPlansTreeNode } from "./KiwiPlansTreeDataProvider";
import { CaseExecutionBoardController } from "./caseExecutionBoardController";
import { ExecutionResultController } from "./executionResultController";
import { TestRunDashboardController } from "./testRunDashboardController";
import { TestRunFilterController } from "./testRunFilterController";
import { buildExecutionQuickPickItems } from "./buildExecutionQuickPickItems";
import { resolveCaseExecutionTarget } from "./commandTargetResolvers";
import {
  pickExecutionItem,
  serializeExecutionItem
} from "./quickPickHelpers";
import { humanMessage } from "./extensionRuntimeSupport";
import { localize } from "./l10n";

type ClientFactory = () => Promise<{
  adapter: ReturnType<typeof createAdapter>;
  config: Awaited<ReturnType<typeof resolveKiwiConfig>>;
}>;

export function registerExecutionCommands(args: {
  clientFactory: ClientFactory;
  caseExecutionBoardController: CaseExecutionBoardController;
  executionResultController: ExecutionResultController;
  testRunDashboardController: TestRunDashboardController;
  testRunFilterController: TestRunFilterController;
}): vscode.Disposable[] {
  const {
    clientFactory,
    caseExecutionBoardController,
    executionResultController,
    testRunDashboardController,
    testRunFilterController
  } = args;

  return [
    vscode.commands.registerCommand(
      "kiwi.manageCaseExecutionsAcrossRuns",
      async (target?: KiwiPlansTreeNode) => {
        const resolved = await resolveCaseExecutionTarget(target);
        if (!resolved) {
          return undefined;
        }

        try {
          const panel = await caseExecutionBoardController.open({
            plan: resolved.plan,
            caseRef: resolved.caseRef
          });
          return panel.title;
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand(
      "kiwi.recordCaseExecutionResult",
      async (target?: KiwiPlansTreeNode, injectedExecutionId?: number) => {
        const resolved = await resolveCaseExecutionTarget(target);
        if (!resolved) {
          return undefined;
        }

        try {
          const { adapter, config } = await clientFactory();
          const executions = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: localize("Loading test executions...")
            },
            async () => adapter.listCaseExecutions(config, resolved.caseRef.id)
          );
          if (executions.length === 0) {
            void vscode.window.showInformationMessage(
              localize("No test executions include this test case.")
            );
            return [];
          }

          const items = buildExecutionQuickPickItems(executions);
          const picked =
            injectedExecutionId !== undefined
              ? items.find((item) => item.execution.id === injectedExecutionId)
              : executions.length === 1
                ? items[0]
                : await pickExecutionItem(items);
          if (!picked) {
            return items.map(serializeExecutionItem);
          }

          const panel = await executionResultController.open({
            plan: resolved.plan,
            caseRef: resolved.caseRef,
            execution: picked.execution
          });
          return panel.title;
        } catch (error) {
          void vscode.window.showErrorMessage(humanMessage(error));
          return undefined;
        }
      }
    ),
    vscode.commands.registerCommand("kiwi.openTestRunDashboard", async (arg?: unknown) => {
      try {
        const runId = typeof arg === "number" && Number.isFinite(arg) ? arg : undefined;
        const panel = await testRunDashboardController.openRun(runId);
        return panel?.title;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    }),
    vscode.commands.registerCommand("kiwi.filterTestRuns", async () => {
      try {
        const panel = await testRunFilterController.open();
        return panel.title;
      } catch (error) {
        void vscode.window.showErrorMessage(humanMessage(error));
        return undefined;
      }
    })
  ];
}
