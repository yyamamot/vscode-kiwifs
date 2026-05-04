import { randomUUID } from "node:crypto";
import * as vscode from "vscode";

export function createNonce(): string {
  return randomUUID().replace(/-/g, "");
}

export function createWebviewContentSecurityPolicy(
  webview: vscode.Webview,
  nonce: string,
  options: { allowHttpsImages?: boolean } = {}
): string {
  const imgSrc = options.allowHttpsImages ? ` img-src ${webview.cspSource} https:;` : "";
  return `default-src 'none';${imgSrc} style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function inlineEscapeHtmlScript(): string {
  return `function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }`;
}
