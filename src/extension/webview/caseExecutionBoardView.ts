import * as vscode from "vscode";
import { localize } from "../l10n";
import {
  renderCaseExecutionBoardWebviewTemplate,
  type CaseExecutionBoardViewLabels
} from "./caseExecutionBoardViewTemplate";
import { createNonce, createWebviewContentSecurityPolicy } from "./webviewUtils";

export function renderCaseExecutionBoardWebviewHtml(webview: vscode.Webview, title: string, state: unknown): string {
  const nonce = createNonce();
  const bootstrap = JSON.stringify(state);
  const csp = createWebviewContentSecurityPolicy(webview, nonce);
  return renderCaseExecutionBoardWebviewTemplate({
    nonce,
    csp,
    title,
    bootstrap,
    language: vscode.env.language,
    labels: caseExecutionBoardViewLabels()
  });
}

function caseExecutionBoardViewLabels(): CaseExecutionBoardViewLabels {
  return {
    reload: localize("Reload"),
    close: localize("Close"),
    add: localize("Add"),
    addExistingRun: localize("Add to Existing Test Run"),
    createRunInThisPlan: localize("Create Test Run in This Plan"),
    closeCreateForm: localize("Close Create Form"),
    addHint: localize("Search and add unregistered runs only when needed."),
    registered: localize("Registered"),
    targetCase: localize("Target Test Case"),
    testRunSummary: localize("Test Run summary"),
    manager: localize("manager"),
    createAndAdd: localize("Create and Add"),
    empty: localize("This test case is not registered in any Test Run yet."),
    selectStatus: localize("Select status"),
    comment: localize("comment"),
    save: localize("Save"),
    open: localize("Open")
  };
}
