import * as vscode from "vscode";

export type AutoCaseFreshnessState = {
  lastCheckedUri?: string;
  lastCheckedVersionToken?: string;
};

export function shouldSkipAutoCaseFreshnessCheck(
  state: AutoCaseFreshnessState,
  uri: vscode.Uri,
  versionToken?: string
): boolean {
  return (
    state.lastCheckedUri === uri.toString() &&
    state.lastCheckedVersionToken === (versionToken ?? "")
  );
}

export function recordAutoCaseFreshnessCheck(
  state: AutoCaseFreshnessState,
  uri: vscode.Uri,
  versionToken?: string
): void {
  state.lastCheckedUri = uri.toString();
  state.lastCheckedVersionToken = versionToken ?? "";
}
