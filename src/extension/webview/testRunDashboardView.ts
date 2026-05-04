import * as vscode from "vscode";
import {
  createNonce,
  createWebviewContentSecurityPolicy,
  inlineEscapeHtmlScript
} from "./webviewUtils";
import { localize } from "../l10n";

export function renderTestRunDashboardWebviewHtml(webview: vscode.Webview, state: unknown): string {
  const nonce = createNonce();
  const bootstrap = JSON.stringify(state);
  const csp = createWebviewContentSecurityPolicy(webview, nonce);
  const labels = JSON.stringify(testRunDashboardLabels());
  const title = localize("Test Run Dashboard");
  return `<!DOCTYPE html>
<html lang="${escapeHtmlAttribute(vscode.env.language)}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtmlAttribute(title)}</title>
  <style>
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); padding: 20px; }
    .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .create-run { margin-bottom: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    select, input, textarea, button { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
    select, input, textarea { padding: 6px 8px; box-sizing: border-box; }
    button { padding: 6px 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid var(--vscode-panel-border); padding: 8px; vertical-align: top; }
    textarea { width: 100%; min-height: 56px; }
    .message { color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
    .current-run { color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
    .empty { padding: 16px 0; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h1>${escapeHtmlAttribute(title)}</h1>
    <div class="toolbar">
      <button id="toggleCreateRun">${escapeHtmlAttribute(localize("Create Test Run"))}</button>
      <button id="openExistingRun">${escapeHtmlAttribute(localize("Open Existing Test Run"))}</button>
      <button id="addCase">${escapeHtmlAttribute(localize("Add Test Case to This Test Run"))}</button>
      <button id="bulkStatus">${escapeHtmlAttribute(localize("Bulk Update Selected Status"))}</button>
      <button id="reload">${escapeHtmlAttribute(localize("Reload"))}</button>
      <button id="close">${escapeHtmlAttribute(localize("Close"))}</button>
    </div>
    <div class="create-run" id="createRunForm" style="display:none;">
      <input id="runSummary" placeholder="${escapeHtmlAttribute(localize("summary"))}" />
      <select id="runPlan"></select>
      <select id="runBuild"></select>
      <input id="runManager" placeholder="${escapeHtmlAttribute(localize("manager"))}" />
      <button id="createRun">${escapeHtmlAttribute(localize("Create"))}</button>
    </div>
    <div class="message" id="message"></div>
    <div class="current-run" id="currentRun"></div>
    <div class="empty" id="emptyState" style="display:none;">${escapeHtmlAttribute(localize("Create a Test Run."))}</div>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>${escapeHtmlAttribute(localize("caseId"))}</th>
        <th>${escapeHtmlAttribute(localize("summary"))}</th>
        <th>${escapeHtmlAttribute(localize("status"))}</th>
        <th>${escapeHtmlAttribute(localize("build"))}</th>
        <th>${escapeHtmlAttribute(localize("comment"))}</th>
        <th>${escapeHtmlAttribute(localize("Open"))}</th>
        <th>${escapeHtmlAttribute(localize("Save"))}</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const labels = ${labels};
    let state = ${bootstrap};
    const message = document.getElementById('message');
    const currentRun = document.getElementById('currentRun');
    const emptyState = document.getElementById('emptyState');
    const addCaseButton = document.getElementById('addCase');
    const bulkStatusButton = document.getElementById('bulkStatus');
    const rows = document.getElementById('rows');
    const createRunForm = document.getElementById('createRunForm');
    const runSummary = document.getElementById('runSummary');
    const runPlan = document.getElementById('runPlan');
    const runBuild = document.getElementById('runBuild');
    const runManager = document.getElementById('runManager');
    function render() {
      createRunForm.style.display = state.createForm.isVisible ? 'flex' : 'none';
      runSummary.value = state.createForm.summary || '';
      runPlan.innerHTML = '';
      for (const plan of state.plans) {
        const option = document.createElement('option');
        option.value = String(plan.id);
        option.textContent = plan.id + ' - ' + plan.name;
        if (String(plan.id) === state.createForm.planId) option.selected = true;
        runPlan.appendChild(option);
      }
      const buildOptions = state.buildOptionsByPlan[state.createForm.planId] || [];
      runBuild.innerHTML = '';
      for (const build of buildOptions) {
        const option = document.createElement('option');
        option.value = String(build.id);
        option.textContent = build.name;
        if (String(build.id) === state.createForm.buildId) option.selected = true;
        runBuild.appendChild(option);
      }
      if (buildOptions.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = labels.noBuilds;
        option.selected = true;
        runBuild.appendChild(option);
      }
      runBuild.value = state.createForm.buildId || runBuild.value || '';
      runManager.value = state.createForm.manager || '';
      rows.innerHTML = '';
      for (const row of state.rows) {
        const tr = document.createElement('tr');
        const statusOptions = state.statuses.map((status) => '<option value="' + status.name + '"' + (status.name === row.status ? ' selected' : '') + '>' + status.name + '</option>').join('');
        tr.innerHTML = '<td><input type="checkbox" data-role="select" data-execution="' + row.executionId + '"' + (row.selected ? ' checked' : '') + '></td>'
          + '<td>' + row.caseId + '</td>'
          + '<td>' + escapeHtml(row.caseSummary) + '</td>'
          + '<td><select data-role="status" data-execution="' + row.executionId + '">' + statusOptions + '</select></td>'
          + '<td>' + escapeHtml(row.build || '-') + '</td>'
          + '<td><textarea data-role="comment" data-execution="' + row.executionId + '">' + escapeHtml(row.comment || '') + '</textarea></td>'
          + '<td><button data-role="open" data-execution="' + row.executionId + '">' + escapeHtml(labels.open) + '</button></td>'
          + '<td><button data-role="save" data-execution="' + row.executionId + '"' + (row.isSaving ? ' disabled' : '') + '>' + escapeHtml(labels.save) + '</button></td>';
        rows.appendChild(tr);
      }
      message.textContent = state.message || '';
      const selectedRun = state.testRuns.find((run) => String(run.id) === state.selectedRunId);
      currentRun.textContent = selectedRun
        ? labels.currentRunPrefix + ': TR' + selectedRun.id + ' ' + selectedRun.summary + (selectedRun.build ? ' / ' + selectedRun.build : '')
        : labels.currentRunPrefix + ': ' + labels.notSelected;
      addCaseButton.disabled = !selectedRun;
      bulkStatusButton.disabled = !selectedRun;
      emptyState.style.display = !selectedRun && state.rows.length === 0 ? 'block' : 'none';
    }
    ${inlineEscapeHtmlScript()}
    document.getElementById('openExistingRun').addEventListener('click', () => vscode.postMessage({ type: 'openExistingRun' }));
    document.getElementById('addCase').addEventListener('click', () => vscode.postMessage({ type: 'addCase' }));
    document.getElementById('bulkStatus').addEventListener('click', () => {
      vscode.postMessage({ type: 'bulkStatus' });
    });
    document.getElementById('toggleCreateRun').addEventListener('click', () => {
      state.createForm.isVisible = !state.createForm.isVisible;
      render();
    });
    runPlan.addEventListener('change', () => {
      state.createForm.planId = runPlan.value;
      const buildOptions = state.buildOptionsByPlan[state.createForm.planId] || [];
      state.createForm.buildId = String(buildOptions[0]?.id || '');
      render();
    });
    document.getElementById('createRun').addEventListener('click', () => {
      vscode.postMessage({
        type: 'createRun',
        summary: runSummary.value,
        planId: Number(runPlan.value),
        buildId: Number(runBuild.value),
        manager: runManager.value
      });
    });
    document.getElementById('reload').addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    document.getElementById('close').addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    rows.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const executionId = Number(target.dataset.execution);
      if (!Number.isFinite(executionId)) return;
      if (target.dataset.role === 'open') {
        vscode.postMessage({ type: 'openRow', executionId });
      }
      if (target.dataset.role === 'save') {
        const status = rows.querySelector('[data-role="status"][data-execution="' + executionId + '"]').value;
        const comment = rows.querySelector('[data-role="comment"][data-execution="' + executionId + '"]').value;
        vscode.postMessage({ type: 'saveRow', executionId, status, comment });
      }
    });
    rows.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const executionId = Number(target.dataset.execution);
      if (!Number.isFinite(executionId)) return;
      if (target.dataset.role === 'select') {
        vscode.postMessage({ type: 'toggleSelected', executionId, selected: target.checked });
      }
    });
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'state') {
        state = event.data.state;
        render();
      }
    });
    render();
  </script>
</body>
</html>`;
}

function testRunDashboardLabels() {
  return {
    noBuilds: localize("(No builds)"),
    open: localize("Open"),
    save: localize("Save"),
    currentRunPrefix: localize("Current Test Run"),
    notSelected: localize("Not selected")
  };
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
