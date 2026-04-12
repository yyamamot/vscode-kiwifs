import * as vscode from "vscode";
import { KiwiCaseExecution } from "../types";

export interface ExecutionQuickPickItem extends vscode.QuickPickItem {
  execution: KiwiCaseExecution;
}

export function buildExecutionQuickPickItems(
  executions: KiwiCaseExecution[]
): ExecutionQuickPickItem[] {
  return [...executions]
    .sort((left, right) => {
      const byRun = left.runId - right.runId;
      return byRun !== 0 ? byRun : left.id - right.id;
    })
    .map((execution) => ({
      label: `${execution.runId} - ${execution.runSummary}`,
      description: `execution ${execution.id} / ${execution.status}`,
      detail: execution.build ? `build: ${execution.build}` : "build: -",
      execution
    }));
}
