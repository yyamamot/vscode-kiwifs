export interface CaseFilterViewLabels {
  title: string;
  query: string;
  queryPlaceholder: string;
  queryTarget: string;
  queryTargetIdSummary: string;
  queryTargetBody: string;
  plan: string;
  allPlans: string;
  status: string;
  priority: string;
  any: string;
  tags: string;
  id: string;
  summary: string;
  snippet: string;
  search: string;
  clear: string;
  close: string;
  selectionCount: string;
  bulkStatus: string;
  bulkAddTags: string;
  bulkRemoveTags: string;
  loadMore: string;
  open: string;
}

export function renderCaseFilterWebviewTemplate(args: {
  nonce: string;
  csp: string;
  bootstrap: string;
  language: string;
  labels: CaseFilterViewLabels;
}): string {
  const { nonce, csp, bootstrap } = args;
  const labels = JSON.stringify(args.labels);
  return `<!DOCTYPE html>
<html lang="${escapeHtml(args.language)}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(args.labels.title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        margin: 0;
        padding: 20px;
      }
      form {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
        margin-bottom: 18px;
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
      .actions, .bulk-actions {
        display: flex;
        gap: 8px;
        align-items: end;
      }
      .bulk-actions {
        margin: 0 0 12px;
        flex-wrap: wrap;
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
      button.link {
        color: var(--vscode-textLink-foreground);
        background: transparent;
        border: 0;
        padding: 0;
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
    </style>
  </head>
  <body data-review-id="shell">
    <h1>${escapeHtml(args.labels.title)}</h1>
    <form id="form" data-review-id="filter-form">
      <label>${escapeHtml(args.labels.query)}
        <input id="query" data-review-id="query-input" type="text" placeholder="${escapeHtml(args.labels.queryPlaceholder)}" />
      </label>
      <label>${escapeHtml(args.labels.queryTarget)}
        <select id="queryTarget" data-review-id="query-target-select"></select>
      </label>
      <label>${escapeHtml(args.labels.plan)}
        <select id="planId" data-review-id="plan-select"></select>
      </label>
      <label>${escapeHtml(args.labels.status)}
        <select id="status" data-review-id="status-select"></select>
      </label>
      <label>${escapeHtml(args.labels.priority)}
        <select id="priority" data-review-id="priority-select"></select>
      </label>
      <label>${escapeHtml(args.labels.tags)}
        <input id="tagsInput" data-review-id="tags-input" type="text" placeholder="smoke, regression" />
      </label>
      <div class="actions" data-review-id="form-actions">
        <button class="primary" id="search" data-review-id="search-button" data-action="search" type="submit">${escapeHtml(args.labels.search)}</button>
        <button class="secondary" id="clear" data-review-id="clear-button" data-action="clear" type="button">${escapeHtml(args.labels.clear)}</button>
        <button class="secondary" id="close" data-review-id="close-button" data-action="close" type="button">${escapeHtml(args.labels.close)}</button>
      </div>
    </form>
    <p class="message" id="message" data-review-id="message"></p>
    <div class="bulk-actions" data-review-id="bulk-actions">
      <span id="selectionSummary" data-review-id="selection-summary">${escapeHtml(args.labels.selectionCount.replace("{0}", "0"))}</span>
      <button class="secondary" id="bulkStatus" data-review-id="bulk-status-button" data-action="bulk-status" type="button">${escapeHtml(args.labels.bulkStatus)}</button>
      <button class="secondary" id="bulkAddTags" data-review-id="bulk-add-tags-button" data-action="bulk-add-tags" type="button">${escapeHtml(args.labels.bulkAddTags)}</button>
      <button class="secondary" id="bulkRemoveTags" data-review-id="bulk-remove-tags-button" data-action="bulk-remove-tags" type="button">${escapeHtml(args.labels.bulkRemoveTags)}</button>
    </div>
    <table data-review-id="result-list">
      <thead data-review-id="result-header">
        <tr>
          <th></th>
          <th>${escapeHtml(args.labels.id)}</th>
          <th class="summary">${escapeHtml(args.labels.summary)}</th>
          <th>${escapeHtml(args.labels.plan)}</th>
          <th>${escapeHtml(args.labels.status)}</th>
          <th>${escapeHtml(args.labels.priority)}</th>
          <th>${escapeHtml(args.labels.tags)}</th>
          <th>${escapeHtml(args.labels.snippet)}</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="results" data-review-id="result-rows"></tbody>
    </table>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const form = document.getElementById('form');
      const query = document.getElementById('query');
      const queryTarget = document.getElementById('queryTarget');
      const planId = document.getElementById('planId');
      const status = document.getElementById('status');
      const priority = document.getElementById('priority');
      const tagsInput = document.getElementById('tagsInput');
      const searchButton = document.getElementById('search');
      const clearButton = document.getElementById('clear');
      const loadMoreButton = document.createElement('button');
      const closeButton = document.getElementById('close');
      const message = document.getElementById('message');
      const results = document.getElementById('results');
      const selectionSummary = document.getElementById('selectionSummary');
      const bulkStatusButton = document.getElementById('bulkStatus');
      const bulkAddTagsButton = document.getElementById('bulkAddTags');
      const bulkRemoveTagsButton = document.getElementById('bulkRemoveTags');
      const labels = ${labels};
      let state = ${bootstrap};

      function option(select, value, text, selected) {
        const item = document.createElement('option');
        item.value = value;
        item.textContent = text;
        item.selected = selected;
        select.appendChild(item);
      }

      function renderSelects() {
        queryTarget.innerHTML = '';
        option(queryTarget, 'id-summary', labels.queryTargetIdSummary, state.formState.queryTarget === 'id-summary');
        option(queryTarget, 'body', labels.queryTargetBody, state.formState.queryTarget === 'body');
        planId.innerHTML = '';
        option(planId, '', labels.allPlans, state.formState.planId === '');
        for (const plan of state.options.plans) {
          option(planId, String(plan.id), plan.id + ' - ' + plan.name, state.formState.planId === String(plan.id));
        }
        status.innerHTML = '';
        option(status, '', labels.any, state.formState.status === '');
        for (const value of state.options.statuses) {
          option(status, value, value, state.formState.status === value);
        }
        priority.innerHTML = '';
        option(priority, '', labels.any, state.formState.priority === '');
        for (const value of state.options.priorities) {
          option(priority, value, value, state.formState.priority === value);
        }
      }

      function renderResults() {
        results.innerHTML = '';
        for (const result of state.visibleResults) {
          const row = document.createElement('tr');
          row.dataset.reviewId = 'result-row-' + result.caseRef.id;
          const selectionCell = document.createElement('td');
          const selection = document.createElement('input');
          selection.type = 'checkbox';
          selection.dataset.reviewId = 'select-case-' + result.caseRef.id;
          selection.dataset.action = 'toggle-selected';
          selection.checked = state.selectedCaseIds.includes(result.caseRef.id);
          selection.disabled = state.isSearching || state.isBulkUpdating;
          selection.addEventListener('change', () => {
            vscode.postMessage({ type: 'toggleSelected', caseId: result.caseRef.id, selected: selection.checked });
          });
          selectionCell.appendChild(selection);
          row.appendChild(selectionCell);
          const cells = [
            result.caseRef.id,
            result.caseRef.summary,
            result.plan.id + ' - ' + result.plan.name,
            result.status,
            result.priority,
            result.tags.join(', '),
            result.textSnippet || ''
          ];
          for (const cellValue of cells) {
            const cell = document.createElement('td');
            cell.textContent = String(cellValue);
            row.appendChild(cell);
          }
          const actionCell = document.createElement('td');
          const open = document.createElement('button');
          open.className = 'link';
          open.type = 'button';
          open.dataset.reviewId = 'open-case-' + result.caseRef.id;
          open.dataset.action = 'open-case';
          open.textContent = labels.open;
          open.addEventListener('click', () => {
            vscode.postMessage({ type: 'open', caseId: result.caseRef.id });
          });
          actionCell.appendChild(open);
          row.appendChild(actionCell);
          results.appendChild(row);
        }
      }

      function render() {
        query.value = state.formState.query;
        tagsInput.value = state.formState.tagsInput;
        renderSelects();
        message.textContent = state.message;
        searchButton.disabled = state.isSearching;
        clearButton.disabled = state.isSearching;
        selectionSummary.textContent = labels.selectionCount.replace('{0}', String(state.selectedCount));
        bulkStatusButton.disabled = state.selectedCount === 0 || state.isSearching || state.isBulkUpdating;
        bulkAddTagsButton.disabled = state.selectedCount === 0 || state.isSearching || state.isBulkUpdating;
        bulkRemoveTagsButton.disabled = state.selectedCount === 0 || state.isSearching || state.isBulkUpdating;
        renderResults();
        loadMoreButton.style.display = state.hasMore ? 'inline-block' : 'none';
      }

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        vscode.postMessage({
          type: 'search',
          formState: {
            query: query.value,
            queryTarget: queryTarget.value,
            planId: planId.value,
            status: status.value,
            priority: priority.value,
            tagsInput: tagsInput.value
          }
        });
      });
      clearButton.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
      bulkStatusButton.addEventListener('click', () => vscode.postMessage({ type: 'bulkUpdateStatus' }));
      bulkAddTagsButton.addEventListener('click', () => vscode.postMessage({ type: 'bulkAddTags' }));
      bulkRemoveTagsButton.addEventListener('click', () => vscode.postMessage({ type: 'bulkRemoveTags' }));
      loadMoreButton.className = 'secondary';
      loadMoreButton.id = 'loadMore';
      loadMoreButton.dataset.reviewId = 'load-more-button';
      loadMoreButton.dataset.action = 'load-more';
      loadMoreButton.type = 'button';
      loadMoreButton.textContent = labels.loadMore;
      loadMoreButton.addEventListener('click', () => vscode.postMessage({ type: 'loadMore' }));
      clearButton.parentElement.insertBefore(loadMoreButton, closeButton);
      closeButton.addEventListener('click', () => vscode.postMessage({ type: 'close' }));
      window.addEventListener('message', (event) => {
        const incoming = event.data;
        if (incoming.type === 'state') {
          state = incoming;
          render();
        } else if (incoming.type === 'error') {
          message.textContent = incoming.message;
        } else if (incoming.type === 'requestUiReviewSnapshot') {
          vscode.postMessage({
            type: 'ui-review-snapshot',
            snapshot: collectUiReviewSnapshot(incoming.reason || 'manual')
          });
        }
      });

      function collectUiReviewSnapshot(reason) {
        return {
          capturedAt: new Date().toISOString(),
          reason,
          selfReview: {
            screen: 'case-filter',
            hasResults: state.visibleResults.length > 0,
            selectedCount: state.selectedCount,
            resultCount: state.totalCount
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
      render();
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
