import * as vscode from "vscode";
import { localize } from "../l10n";
import { renderTestRunFilterWebviewTemplate, type TestRunFilterViewLabels } from "./testRunFilterViewTemplate";
import { createNonce, createWebviewContentSecurityPolicy } from "./webviewUtils";

export function renderTestRunFilterWebviewHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const csp = createWebviewContentSecurityPolicy(webview, nonce, { allowHttpsImages: true });
  return renderTestRunFilterWebviewTemplate({
    nonce,
    csp,
    language: vscode.env.language,
    labels: testRunFilterViewLabels()
  });
}

export function testRunFilterViewLabels(): TestRunFilterViewLabels {
  return {
    title: localize("Find Test Runs"),
    query: localize("Query"),
    queryPlaceholder: localize("Example: 300 / Regression run"),
    plan: localize("Plan"),
    build: localize("Build"),
    allBuilds: localize("All Builds"),
    search: localize("Search"),
    clear: localize("Clear"),
    reload: localize("Reload"),
    close: localize("Close"),
    empty: localize("No matching Test Runs."),
    runId: localize("runId"),
    summary: localize("summary"),
    manager: localize("manager"),
    open: localize("Open"),
    initialMessage: localize("Enter conditions and search.")
  };
}
