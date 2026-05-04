import * as vscode from "vscode";
import { localize } from "../l10n";
import { type CaseFilterViewLabels, renderCaseFilterWebviewTemplate } from "./caseFilterViewTemplate";
import { createNonce, createWebviewContentSecurityPolicy } from "./webviewUtils";

export function renderCaseFilterWebviewHtml(webview: vscode.Webview, state: unknown): string {
  const nonce = createNonce();
  const bootstrap = JSON.stringify(state);
  const csp = createWebviewContentSecurityPolicy(webview, nonce);
  return renderCaseFilterWebviewTemplate({
    nonce,
    csp,
    bootstrap,
    language: vscode.env.language,
    labels: caseFilterViewLabels()
  });
}

export function caseFilterViewLabels(): CaseFilterViewLabels {
  return {
    title: localize("Find Test Cases"),
    query: localize("Query"),
    queryPlaceholder: localize("ID or summary"),
    queryTarget: localize("Query Target"),
    queryTargetIdSummary: localize("ID / Summary"),
    queryTargetBody: localize("Full body text"),
    plan: localize("Plan"),
    allPlans: localize("All Plans"),
    status: localize("Status"),
    priority: localize("Priority"),
    any: localize("Any"),
    tags: localize("Tags"),
    id: localize("ID"),
    summary: localize("Summary"),
    snippet: localize("Snippet"),
    search: localize("Search"),
    clear: localize("Clear"),
    close: localize("Close"),
    selectionCount: localize("Selected: {0}"),
    bulkStatus: localize("Bulk change status"),
    bulkAddTags: localize("Add tags"),
    bulkRemoveTags: localize("Remove tags"),
    loadMore: localize("Show more"),
    open: localize("Open")
  };
}
