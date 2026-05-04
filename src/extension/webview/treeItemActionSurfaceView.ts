import * as vscode from "vscode";
import { TreeItemActionSurfaceState } from "../treeItemActionSurfaceModel";
import { localize } from "../l10n";
import {
  createNonce,
  createWebviewContentSecurityPolicy,
  escapeHtml
} from "./webviewUtils";

export function renderTreeItemActionSurfaceWebviewHtml(
  webview: vscode.Webview,
  state: TreeItemActionSurfaceState
): string {
  const nonce = createNonce();
  const bootstrap = JSON.stringify(state);
  const csp = createWebviewContentSecurityPolicy(webview, nonce);
  const categoryLabels = JSON.stringify({
    inspect: localize("Inspect"),
    cases: localize("Test Cases"),
    edit: localize("Edit"),
    create: localize("Create"),
    attachments: localize("Attachments"),
    execution: localize("Test Execution"),
    mirror: localize("Local Mirror"),
    danger: localize("Remove / Delete")
  });

  return `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language)}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(state.title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        padding: 20px;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        font-family: var(--vscode-font-family);
      }
      header {
        margin-bottom: 18px;
      }
      h1 {
        margin: 0 0 4px;
        font-size: 20px;
        font-weight: 650;
      }
      .subtitle {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .surface {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
        max-width: 960px;
      }
      .overview {
        max-width: 960px;
        margin: 0 0 12px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        overflow: hidden;
      }
      .overview dl {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        gap: 0;
        margin: 0;
      }
      .overview dt,
      .overview dd {
        margin: 0;
        padding: 8px 11px;
        border-top: 1px solid var(--vscode-panel-border);
        font-size: 12px;
        line-height: 1.35;
      }
      .overview dt {
        color: var(--vscode-descriptionForeground);
        font-weight: 600;
      }
      .overview dd {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      section {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        overflow: hidden;
      }
      h2 {
        margin: 0;
        padding: 9px 11px;
        font-size: 12px;
        font-weight: 650;
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-sideBarSectionHeader-background);
      }
      .items {
        display: grid;
      }
      button {
        display: grid;
        gap: 3px;
        width: 100%;
        padding: 10px 11px;
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        background: transparent;
        border: 0;
        border-top: 1px solid var(--vscode-panel-border);
        text-align: left;
        cursor: pointer;
      }
      button:first-child {
        border-top: 0;
      }
      button:hover,
      button:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
        background: var(--vscode-list-hoverBackground);
      }
      button.danger .label {
        color: var(--vscode-errorForeground);
      }
      .label {
        font-size: 13px;
        font-weight: 600;
      }
      .description {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        line-height: 1.35;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(state.title)}</h1>
      <div class="subtitle">${escapeHtml(state.subtitle)}</div>
    </header>
    ${renderOverview(state)}
    <main class="surface" id="surface"></main>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = ${bootstrap};
      const categoryLabels = ${categoryLabels};
      const surface = document.getElementById('surface');
      const categories = ['inspect', 'cases', 'edit', 'create', 'attachments', 'execution', 'mirror', 'danger'];
      for (const category of categories) {
        const items = state.items.filter((item) => item.category === category);
        if (items.length === 0) continue;
        const section = document.createElement('section');
        const heading = document.createElement('h2');
        heading.textContent = categoryLabels[category] || category;
        const list = document.createElement('div');
        list.className = 'items';
        for (const item of items) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = item.mode === 'danger' ? 'danger' : '';
          button.dataset.actionId = item.id;
          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = item.label;
          const description = document.createElement('span');
          description.className = 'description';
          description.textContent = item.description;
          button.append(label, description);
          button.addEventListener('click', () => {
            vscode.postMessage({ type: 'run', actionId: item.id });
          });
          list.appendChild(button);
        }
        section.append(heading, list);
        surface.appendChild(section);
      }
    </script>
  </body>
</html>`;
}

function renderOverview(state: TreeItemActionSurfaceState): string {
  if (!state.overview) {
    return "";
  }
  return `<section class="overview">
      <h2>${escapeHtml(state.overview.title)}</h2>
      <dl>${state.overview.rows.map((row) =>
        `<dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd>`
      ).join("")}</dl>
    </section>`;
}
