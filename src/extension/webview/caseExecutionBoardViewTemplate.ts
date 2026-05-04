import { escapeHtml, inlineEscapeHtmlScript } from "./webviewUtils";

export interface CaseExecutionBoardViewLabels {
  reload: string;
  close: string;
  add: string;
  addExistingRun: string;
  createRunInThisPlan: string;
  closeCreateForm: string;
  addHint: string;
  registered: string;
  targetCase: string;
  testRunSummary: string;
  manager: string;
  createAndAdd: string;
  empty: string;
  selectStatus: string;
  comment: string;
  save: string;
  open: string;
}

export function renderCaseExecutionBoardWebviewTemplate(args: {
  nonce: string;
  csp: string;
  title: string;
  bootstrap: string;
  language: string;
  labels: CaseExecutionBoardViewLabels;
}): string {
  const { nonce, csp, title, bootstrap } = args;
  const labels = JSON.stringify(args.labels);
  return `<!DOCTYPE html>
<html lang="${escapeHtml(args.language)}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); padding: 20px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
    .summary { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
    .section { border: 1px solid var(--vscode-panel-border); border-radius: 8px; margin-bottom: 18px; padding: 14px; }
    .section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .group-title { font-weight: 600; margin-bottom: 10px; }
    .row { display: grid; grid-template-columns: minmax(220px, 1.5fr) minmax(110px, .7fr) minmax(140px, .8fr) minmax(220px, 1.2fr) auto auto; gap: 8px; align-items: start; margin-bottom: 8px; }
    .run-title { font-weight: 600; }
    .hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
    select, input, textarea, button { box-sizing: border-box; }
    select, input, textarea { width: 100%; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; }
    textarea { min-height: 72px; resize: vertical; }
    .create-form { display: grid; grid-template-columns: minmax(220px, 1.2fr) minmax(180px, .9fr) minmax(220px, 1.1fr) minmax(180px, .9fr) auto; gap: 8px; margin-top: 12px; }
    .message { margin-top: 14px; color: var(--vscode-descriptionForeground); }
    .empty { color: var(--vscode-descriptionForeground); padding: 18px 0; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="reload">${escapeHtml(args.labels.reload)}</button>
    <button id="close">${escapeHtml(args.labels.close)}</button>
  </div>
  <div class="summary" id="summary"></div>
  <section class="section">
    <div class="section-head">
      <strong>${escapeHtml(args.labels.add)}</strong>
      <div>
        <button id="addExistingRun">${escapeHtml(args.labels.addExistingRun)}</button>
        <button id="toggleCreateRun">${escapeHtml(args.labels.createRunInThisPlan)}</button>
      </div>
    </div>
    <div class="hint">${escapeHtml(args.labels.addHint)}</div>
    <div id="createFormHost"></div>
  </section>
  <section class="section">
    <div class="section-head">
      <strong>${escapeHtml(args.labels.registered)}</strong>
    </div>
    <div id="groups"></div>
  </section>
  <div class="message" id="message"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const labels = ${labels};
    let state = ${bootstrap};
    const summaryEl = document.getElementById('summary');
    const groupsEl = document.getElementById('groups');
    const createFormHost = document.getElementById('createFormHost');
    const messageEl = document.getElementById('message');
    const reloadButton = document.getElementById('reload');
    const closeButton = document.getElementById('close');
    const addExistingRunButton = document.getElementById('addExistingRun');
    const toggleCreateRunButton = document.getElementById('toggleCreateRun');

    function render() {
      summaryEl.textContent = labels.targetCase + ': ' + state.target.caseRef.id + ' - ' + state.target.caseRef.summary;
      messageEl.textContent = state.message || '';
      toggleCreateRunButton.textContent = state.addSection.createForm.isVisible ? labels.closeCreateForm : labels.createRunInThisPlan;

      renderCreateForm();
      renderGroups();
    }

    function renderCreateForm() {
      createFormHost.innerHTML = '';
      if (!state.addSection.createForm.isVisible) return;

      const form = document.createElement('div');
      form.className = 'create-form';
      const summary = document.createElement('input');
      summary.placeholder = labels.testRunSummary;
      summary.value = state.addSection.createForm.summary || '';

      const plan = document.createElement('select');
      for (const item of state.plans) {
        const option = document.createElement('option');
        option.value = String(item.id);
        option.textContent = item.id + ' - ' + item.name;
        if (String(item.id) === state.addSection.createForm.planId) option.selected = true;
        plan.appendChild(option);
      }

      const build = document.createElement('select');
      fillBuildOptions(build, state.addSection.createForm.planId, state.addSection.createForm.buildId);
      plan.addEventListener('change', () => {
        build.innerHTML = '';
        vscode.postMessage({ type: 'changeCreatePlan', planId: Number(plan.value) });
      });

      const manager = document.createElement('input');
      manager.placeholder = labels.manager;
      manager.value = state.addSection.createForm.manager || '';

      const submit = document.createElement('button');
      submit.textContent = labels.createAndAdd;
      submit.addEventListener('click', () => {
        vscode.postMessage({
          type: 'createRun',
          planId: Number(plan.value),
          summary: summary.value,
          buildId: Number(build.value),
          manager: manager.value
        });
      });

      form.appendChild(summary);
      form.appendChild(plan);
      form.appendChild(build);
      form.appendChild(manager);
      form.appendChild(submit);
      createFormHost.appendChild(form);
    }

    function fillBuildOptions(select, planId, selectedBuildId) {
      select.innerHTML = '';
      const options = state.buildOptionsByPlan[planId] || [];
      for (const item of options) {
        const option = document.createElement('option');
        option.value = String(item.id);
        option.textContent = item.name;
        if (String(item.id) === selectedBuildId) option.selected = true;
        select.appendChild(option);
      }
    }

    function renderGroups() {
      groupsEl.innerHTML = '';
      if (state.groups.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = labels.empty;
        groupsEl.appendChild(empty);
        return;
      }
      for (const group of state.groups) {
        const section = document.createElement('section');
        const title = document.createElement('div');
        title.className = 'group-title';
        title.textContent = group.planName + ' (Plan ID: ' + group.planId + ')';
        section.appendChild(title);

        for (const row of group.rows) {
          const wrapper = document.createElement('div');
          wrapper.className = 'row';

          const meta = document.createElement('div');
          meta.innerHTML = '<div class="run-title">TR' + row.runId + ' ' + escapeHtml(row.runSummary) + '</div>';
          wrapper.appendChild(meta);

          const build = document.createElement('div');
          build.textContent = row.build || '';
          wrapper.appendChild(build);

          const status = document.createElement('select');
          const emptyOption = document.createElement('option');
          emptyOption.value = '';
          emptyOption.textContent = labels.selectStatus;
          status.appendChild(emptyOption);
          for (const item of state.statuses) {
            const option = document.createElement('option');
            option.value = item.name;
            option.textContent = item.name;
            if (item.name === row.status) option.selected = true;
            status.appendChild(option);
          }
          wrapper.appendChild(status);

          const comment = document.createElement('textarea');
          comment.placeholder = labels.comment;
          comment.value = row.comment || '';
          wrapper.appendChild(comment);

          const save = document.createElement('button');
          save.textContent = labels.save;
          save.addEventListener('click', () => {
            vscode.postMessage({ type: 'saveRow', runId: row.runId, status: status.value, comment: comment.value });
          });
          wrapper.appendChild(save);

          const open = document.createElement('button');
          open.textContent = labels.open;
          open.addEventListener('click', () => vscode.postMessage({ type: 'openRow', runId: row.runId }));
          wrapper.appendChild(open);

          section.appendChild(wrapper);
        }
        groupsEl.appendChild(section);
      }
    }

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'state') {
        state = event.data.state;
        render();
      }
    });
    reloadButton.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    closeButton.addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    addExistingRunButton.addEventListener('click', () => vscode.postMessage({ type: 'addExistingRun' }));
    toggleCreateRunButton.addEventListener('click', () => vscode.postMessage({ type: 'toggleCreateForm' }));
    render();

    ${inlineEscapeHtmlScript()}
  </script>
</body>
</html>`;
}
