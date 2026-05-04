import * as vscode from "vscode";
import { localize } from "../l10n";
import {
  createNonce,
  createWebviewContentSecurityPolicy,
  escapeHtml
} from "./webviewUtils";

export function renderCaseMetadataEditorWebviewHtml(webview: vscode.Webview, title: string, state: unknown): string {
  const nonce = createNonce();
  const bootstrap = JSON.stringify(state);
  const csp = createWebviewContentSecurityPolicy(webview, nonce);
  const labels = JSON.stringify(caseMetadataEditorLabels());

  return `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language)}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        margin: 0;
        padding: 20px;
      }
      form {
        display: grid;
        gap: 16px;
        max-width: 720px;
      }
      label {
        display: grid;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
      }
      input, select {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, transparent);
      }
      .description {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .template-warning {
        color: var(--vscode-notificationsWarningIcon-foreground, var(--vscode-descriptionForeground));
        font-size: 12px;
      }
      .actions {
        display: flex;
        gap: 8px;
      }
      button {
        padding: 8px 14px;
        border: 1px solid var(--vscode-button-border, transparent);
        cursor: pointer;
      }
      button.primary {
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
      }
      button.secondary {
        color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
        background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      }
      .error {
        min-height: 1.2em;
        color: var(--vscode-errorForeground);
      }
    </style>
  </head>
  <body>
    <form id="form">
      <div class="description" id="description"></div>
      <label>${escapeHtml(localize("Overview"))}
        <input id="summary" type="text" />
      </label>
      <label>${escapeHtml(localize("Status"))}
        <select id="status"></select>
      </label>
      <label>${escapeHtml(localize("Priority"))}
        <select id="priority"></select>
      </label>
      <label>${escapeHtml(localize("Tags"))}
        <input id="tagsInput" type="text" placeholder="smoke, regression" />
      </label>
      <label id="templateLabel">${escapeHtml(localize("Template"))}
        <select id="template"></select>
        <span class="description">${escapeHtml(localize("Use the selected template body as the initial body."))}</span>
      </label>
      <div class="template-warning" id="templateWarning"></div>
      <div class="error" id="error"></div>
      <div class="actions">
        <button class="primary" id="save" type="submit">${escapeHtml(localize("Save"))}</button>
        <button class="secondary" id="reload" type="button">${escapeHtml(localize("Reload"))}</button>
        <button class="secondary" id="cancel" type="button">${escapeHtml(localize("Cancel"))}</button>
      </div>
    </form>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const labels = ${labels};
      const form = document.getElementById('form');
      const summary = document.getElementById('summary');
      const status = document.getElementById('status');
      const priority = document.getElementById('priority');
      const tagsInput = document.getElementById('tagsInput');
      const templateLabel = document.getElementById('templateLabel');
      const template = document.getElementById('template');
      const templateWarning = document.getElementById('templateWarning');
      const description = document.getElementById('description');
      const saveButton = document.getElementById('save');
      const reloadButton = document.getElementById('reload');
      const cancelButton = document.getElementById('cancel');
      const error = document.getElementById('error');
      let state = ${bootstrap};

      function renderSelect(select, values, current) {
        select.innerHTML = '';
        for (const value of values) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          option.selected = value === current;
          select.appendChild(option);
        }
      }

      function renderTemplateSelect(select, options, current) {
        select.innerHTML = '';
        for (const item of options) {
          const option = document.createElement('option');
          option.value = item.id;
          option.textContent = item.name;
          option.selected = item.id === current;
          select.appendChild(option);
        }
      }

      function renderDescription(mode) {
        if (mode === 'create') {
          return labels.createDescription;
        }
        if (mode === 'duplicate') {
          return labels.duplicateDescription;
        }
        return labels.editDescription;
      }

      function render() {
        summary.value = state.formState.summary;
        tagsInput.value = state.formState.tagsInput;
        renderSelect(status, state.options.statuses, state.formState.status);
        renderSelect(priority, state.options.priorities, state.formState.priority);
        renderTemplateSelect(template, state.templateOptions || [], state.selectedTemplateId);
        templateLabel.style.display = state.mode === 'create' ? 'grid' : 'none';
        templateWarning.style.display = state.mode === 'create' && state.templateWarning ? 'block' : 'none';
        templateWarning.textContent = state.templateWarning || '';
        description.textContent = renderDescription(state.mode);
        saveButton.disabled = state.isSaving;
        saveButton.textContent = state.actionLabel;
        reloadButton.disabled = state.isSaving;
      }

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        error.textContent = '';
        vscode.postMessage({
          type: 'save',
          formState: {
            summary: summary.value,
            status: status.value,
            priority: priority.value,
            tagsInput: tagsInput.value
          },
          selectedTemplateId: template.value
        });
      });
      reloadButton.addEventListener('click', () => {
        error.textContent = '';
        vscode.postMessage({ type: 'reload', selectedTemplateId: template.value });
      });
      cancelButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancel' });
      });
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'state') {
          state = message;
          render();
        } else if (message.type === 'error') {
          error.textContent = message.message;
        }
      });
      render();
    </script>
  </body>
</html>`;
}

function caseMetadataEditorLabels() {
  return {
    createDescription: localize("Enter metadata to create a new test case in the test plan. Edit the body after creation in the test case body document."),
    duplicateDescription: localize("Duplicate the original body into a new test case. Edit the body after creation in the test case body document."),
    editDescription: localize("Edit basic information. The body is not updated.")
  };
}
