import { inlineEscapeHtmlScript } from "./webviewUtils";

export interface TestRunFilterViewLabels {
  title: string;
  query: string;
  queryPlaceholder: string;
  plan: string;
  build: string;
  allBuilds: string;
  search: string;
  clear: string;
  reload: string;
  close: string;
  empty: string;
  runId: string;
  summary: string;
  manager: string;
  open: string;
  initialMessage: string;
}

export function renderTestRunFilterWebviewTemplate(args: {
  nonce: string;
  csp: string;
  language: string;
  labels: TestRunFilterViewLabels;
}): string {
  const { nonce, csp } = args;
  const labels = JSON.stringify(args.labels);
  return `<!DOCTYPE html>
<html lang="${escapeHtmlAttribute(args.language)}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtmlAttribute(args.labels.title)}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      padding: 16px;
    }
    form {
      display: grid;
      gap: 12px;
      margin-bottom: 12px;
    }
    label {
      display: grid;
      gap: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    input, select, button {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      color: inherit;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
    }
    button {
      width: auto;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 0;
    }
    button.secondary {
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    }
    button.link {
      color: var(--vscode-textLink-foreground);
      background: transparent;
      border: 0;
      padding: 0;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .message {
      color: var(--vscode-descriptionForeground);
      margin: 0 0 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      font-weight: 600;
    }
    .summary {
      min-width: 220px;
    }
    h1 {
      margin: 0 0 16px;
      font-size: 26px;
      font-weight: 600;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      padding: 8px 0;
    }
  </style>
</head>
<body data-review-id="shell">
  <h1>${escapeHtmlAttribute(args.labels.title)}</h1>
  <form id="form" data-review-id="filter-form">
    <label for="query">${escapeHtmlAttribute(args.labels.query)}
      <input id="query" data-review-id="query-input" type="text" placeholder="${escapeHtmlAttribute(args.labels.queryPlaceholder)}" />
    </label>
    <label for="plan">${escapeHtmlAttribute(args.labels.plan)}
      <select id="plan" data-review-id="plan-select"></select>
    </label>
    <label for="build">${escapeHtmlAttribute(args.labels.build)}
      <select id="build" data-review-id="build-select"></select>
    </label>
    <div class="actions" data-review-id="form-actions">
      <button class="primary" id="search" data-review-id="search-button" data-action="search" type="submit">${escapeHtmlAttribute(args.labels.search)}</button>
      <button class="secondary" id="clear" data-review-id="clear-button" data-action="clear" type="button">${escapeHtmlAttribute(args.labels.clear)}</button>
      <button class="secondary" id="reload" data-review-id="reload-button" data-action="reload" type="button">${escapeHtmlAttribute(args.labels.reload)}</button>
      <button class="secondary" id="close" data-review-id="close-button" data-action="close" type="button">${escapeHtmlAttribute(args.labels.close)}</button>
    </div>
  </form>
  <div class="message" id="message" data-review-id="message"></div>
  <div id="results" data-review-id="result-list"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('form');
    const query = document.getElementById('query');
    const plan = document.getElementById('plan');
    const build = document.getElementById('build');
    const message = document.getElementById('message');
    const results = document.getElementById('results');
    const searchButton = document.getElementById('search');
    const clearButton = document.getElementById('clear');
    const reloadButton = document.getElementById('reload');
    const closeButton = document.getElementById('close');
    const labels = ${labels};

    function postSearch() {
      vscode.postMessage({
        type: 'search',
        formState: {
          query: query.value,
          planId: plan.value,
          build: build.value
        }
      });
    }

    function renderBuildOptions(state) {
      const builds = state.options.buildOptionsByPlan[plan.value] ?? state.options.buildOptionsByPlan[''] ?? [];
      build.innerHTML = ['<option value="">' + escapeHtml(labels.allBuilds) + '</option>']
        .concat(builds.map((item) => '<option value="' + item + '">' + item + '</option>'))
        .join('');
      if (state.formState.build && builds.includes(state.formState.build)) {
        build.value = state.formState.build;
      } else {
        build.value = '';
      }
    }

    function renderResults(state) {
      if (state.results.length === 0) {
        if (state.message === labels.initialMessage) {
          results.innerHTML = '';
          return;
        }
        results.innerHTML = '<div class="empty" data-review-id="empty-results">' + escapeHtml(labels.empty) + '</div>';
        return;
      }
      results.innerHTML = '<table data-review-id="result-table"><thead data-review-id="result-header"><tr><th>' + escapeHtml(labels.runId) + '</th><th class="summary">' + escapeHtml(labels.summary) + '</th><th>' + escapeHtml(labels.plan) + '</th><th>' + escapeHtml(labels.build) + '</th><th>' + escapeHtml(labels.manager) + '</th><th></th></tr></thead><tbody data-review-id="result-rows">' +
        state.results.map((run) => '<tr data-review-id="result-row-' + run.id + '">' +
          '<td>TR' + run.id + '</td>' +
          '<td>' + escapeHtml(run.summary) + '</td>' +
          '<td>' + escapeHtml(run.planName || '-') + '</td>' +
          '<td>' + escapeHtml(run.build || '-') + '</td>' +
          '<td>' + escapeHtml(run.manager || '-') + '</td>' +
          '<td><button class="link" type="button" data-review-id="open-run-' + run.id + '" data-action="open-run" data-run-id="' + run.id + '">' + escapeHtml(labels.open) + '</button></td>' +
        '</tr>').join('') +
        '</tbody></table>';
      results.querySelectorAll('button[data-run-id]').forEach((button) => {
        button.addEventListener('click', () => {
          vscode.postMessage({ type: 'open', runId: Number(button.dataset.runId) });
        });
      });
    }

    ${inlineEscapeHtmlScript()}

    function render(state) {
      query.value = state.formState.query;
      plan.innerHTML = state.options.plans.map((item) => '<option value="' + item.value + '">' + item.label + '</option>').join('');
      plan.value = state.formState.planId;
      renderBuildOptions(state);
      message.textContent = state.message;
      searchButton.disabled = state.isSearching;
      clearButton.disabled = state.isSearching;
      renderResults(state);
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      postSearch();
    });
    clearButton.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
    reloadButton.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    closeButton.addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    plan.addEventListener('change', () => renderBuildOptions(window.__state));

    window.addEventListener('message', (event) => {
      const state = event.data?.state;
      if (event.data?.type === 'requestUiReviewSnapshot') {
        vscode.postMessage({
          type: 'ui-review-snapshot',
          snapshot: collectUiReviewSnapshot(event.data.reason || 'manual')
        });
        return;
      }
      if (!state) {
        return;
      }
      window.__state = state;
      render(state);
    });

    function collectUiReviewSnapshot(reason) {
      const state = window.__state || { results: [], formState: {}, message: '' };
      return {
        capturedAt: new Date().toISOString(),
        reason,
        selfReview: {
          screen: 'test-run-filter',
          hasResults: state.results.length > 0,
          selectedCount: 0,
          resultCount: state.results.length
        },
        geometry: collectUiReviewGeometry()
      };
    }

    function collectUiReviewGeometry() {
      return {
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        elements: Array.from(document.querySelectorAll('[data-review-id]')).map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            reviewId: element.dataset.reviewId || '',
            tagName: element.tagName,
            role: element.getAttribute('role') || '',
            label: element.getAttribute('aria-label') || element.textContent.trim().replace(/\\s+/g, ' ').slice(0, 120),
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true',
            action: element.dataset.action,
            className: typeof element.className === 'string' ? element.className : '',
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left
            },
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight
          };
        })
      };
    }
  </script>
</body>
</html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
