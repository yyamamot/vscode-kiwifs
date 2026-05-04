import * as vscode from "vscode";
import { localize } from "../l10n";
import {
  createNonce,
  createWebviewContentSecurityPolicy,
  escapeHtml
} from "./webviewUtils";

export function renderExecutionResultWebviewHtml(webview: vscode.Webview, title: string, state: unknown): string {
  const nonce = createNonce();
  const bootstrap = JSON.stringify(state);
  const csp = createWebviewContentSecurityPolicy(webview, nonce);
  const labels = JSON.stringify({
    build: localize("build")
  });
  return `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language)}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); padding: 20px; }
    label { display: block; margin-top: 14px; font-weight: 600; }
    select, textarea { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; }
    textarea { min-height: 120px; }
    button { margin-top: 18px; margin-right: 8px; }
    .meta { color: var(--vscode-descriptionForeground); line-height: 1.6; }
    .message { margin-top: 12px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h1>${escapeHtml(localize("Update Test Case Execution Result"))}</h1>
  <div class="meta" id="meta"></div>
  <label for="status">${escapeHtml(localize("Status"))}</label>
  <select id="status"></select>
  <label for="comment">${escapeHtml(localize("Comment"))}</label>
  <textarea id="comment" placeholder="${escapeHtml(localize("Optional comment"))}"></textarea>
  <div>
    <button id="save">${escapeHtml(localize("Save"))}</button>
    <button id="reload">${escapeHtml(localize("Reload"))}</button>
    <button id="close">${escapeHtml(localize("Cancel"))}</button>
  </div>
  <div class="message" id="message"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const labels = ${labels};
    let state = ${bootstrap};
    const status = document.getElementById('status');
    const comment = document.getElementById('comment');
    const save = document.getElementById('save');
    const message = document.getElementById('message');
    const meta = document.getElementById('meta');
    function render() {
      meta.textContent = 'Test Run ' + state.target.execution.runId + ' - ' + state.target.execution.runSummary + ' / ' + labels.build + ': ' + (state.target.execution.build || '-');
      status.innerHTML = '';
      for (const option of state.statuses) {
        const item = document.createElement('option');
        item.value = option.name;
        item.textContent = option.name;
        if (option.name === state.formState.status) item.selected = true;
        status.appendChild(item);
      }
      comment.value = state.formState.comment || '';
      save.disabled = state.isSaving;
      message.textContent = state.message || '';
    }
    save.addEventListener('click', () => vscode.postMessage({ type: 'save', formState: { status: status.value, comment: comment.value } }));
    document.getElementById('reload').addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    document.getElementById('close').addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'state') {
        state = event.data;
        render();
      }
    });
    render();
  </script>
</body>
</html>`;
}
