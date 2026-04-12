import * as vscode from "vscode";
import { KiwiCaseExecution, KiwiPlan, KiwiTestRun } from "../types";

export type CaseExecutionBoardRow = {
  runId: number;
  runSummary: string;
  build: string;
  executionId: number;
  status: string;
  comment: string;
  isSaving: boolean;
};

export type CaseExecutionBoardGroup = {
  planId: number;
  planName: string;
  rows: CaseExecutionBoardRow[];
};

export type CaseExecutionBoardAddQuickPickItem = vscode.QuickPickItem & {
  run: KiwiTestRun;
  plan: KiwiPlan;
};

export function buildRegisteredCaseExecutionBoardGroups(input: {
  plans: KiwiPlan[];
  runs: KiwiTestRun[];
  executions: KiwiCaseExecution[];
}): CaseExecutionBoardGroup[] {
  const planById = new Map(input.plans.map((plan) => [plan.id, plan]));
  const runById = new Map(input.runs.map((run) => [run.id, run]));
  const groups = new Map<number, CaseExecutionBoardGroup>();

  for (const execution of [...input.executions].sort((left, right) => left.runId - right.runId)) {
    const run = runById.get(execution.runId);
    if (!run || run.planId === undefined) {
      continue;
    }
    const planId = run.planId;
    const plan = planById.get(planId);
    const existing = groups.get(planId);
    const next: CaseExecutionBoardGroup = existing ?? {
      planId,
      planName: plan?.name ?? `Plan ${planId}`,
      rows: []
    };
    next.rows.push({
      runId: execution.runId,
      runSummary: run?.summary ?? execution.runSummary,
      build: execution.build,
      executionId: execution.id,
      status: execution.status,
      comment: "",
      isSaving: false
    });
    groups.set(planId, next);
  }

  return [...groups.values()].sort((left, right) => left.planId - right.planId);
}

export function buildCaseExecutionBoardAddQuickPickItems(input: {
  plans: KiwiPlan[];
  runs: KiwiTestRun[];
  executions: KiwiCaseExecution[];
}): CaseExecutionBoardAddQuickPickItem[] {
  const planById = new Map(input.plans.map((plan) => [plan.id, plan]));
  const registeredRunIds = new Set(input.executions.map((execution) => execution.runId));

  return input.runs
    .filter((run): run is KiwiTestRun & { planId: number } => !registeredRunIds.has(run.id) && run.planId !== undefined)
    .sort((left, right) => left.id - right.id)
    .map((run) => {
      const plan = planById.get(run.planId);
      return {
        label: `TR${run.id} ${run.summary}`,
        description: plan ? `${plan.id} - ${plan.name}` : "",
        detail: run.build ? `build: ${run.build}` : "",
        run,
        plan: plan ?? { id: run.planId, name: `Plan ${run.planId}` }
      };
    });
}
