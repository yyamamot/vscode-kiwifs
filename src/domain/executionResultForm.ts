import { KiwiCaseExecution, KiwiExecutionStatus, KiwiExecutionUpdatePatch } from "../types";
import { KiwiError } from "./errors";

export interface ExecutionResultFormState {
  status: string;
  comment: string;
}

export function toExecutionResultFormState(
  execution: KiwiCaseExecution
): ExecutionResultFormState {
  return {
    status: execution.status,
    comment: ""
  };
}

export function diffExecutionResultPatch(
  source: KiwiCaseExecution,
  formState: ExecutionResultFormState,
  statuses: KiwiExecutionStatus[]
): KiwiExecutionUpdatePatch {
  const nextStatus = formState.status.trim();
  if (!nextStatus) {
    throw new KiwiError("ValidationFailed", "Execution status is required.");
  }
  if (!statuses.some((status) => status.name === nextStatus)) {
    throw new KiwiError("ValidationFailed", `Execution status '${nextStatus}' is not available.`);
  }

  const patch: KiwiExecutionUpdatePatch = {};
  if (source.status !== nextStatus) {
    patch.status = nextStatus;
  }
  const comment = formState.comment.trim();
  if (comment) {
    patch.comment = comment;
  }
  return patch;
}
