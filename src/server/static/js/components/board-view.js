// Board view - Kanban-style workflow runs view
import { api } from '../api.js';

export class BoardView {
  constructor(container, props = {}) {
    this.container = container;
    this.workflows = [];
    this.currentWorkflow = null;
    this.runs = [];
    this.highlightRunId = props.highlightRunId;
    this.render();
    this.init();
  }

  async init() {
    await this.loadWorkflows();
    if (this.highlightRunId) {
      // If highlighting a specific run, find its workflow
      try {
        const run = await api.getRun(this.highlightRunId);
        if (run) {
          this.currentWorkflow = run.workflow_id;
          const select = document.getElementById('wf-select');
          if (select) select.value = this.currentWorkflow;
        }
      } catch (e) {
        console.error('Failed to load run:', e);
      }
    }
    await this.loadRuns();
  }

  async loadWorkflows() {
    try {
      this.workflows = await api.getWorkflows();
      const select = document.getElementById('wf-select');
      if (select) {
        select.innerHTML = this.workflows.map(w =>
          `<option value="${this.escapeHtml(w.id)}" ${w.id === this.currentWorkflow ? 'selected' : ''}>${this.escapeHtml(w.name)}</option>`
        ).join('');
      }
      if (!this.currentWorkflow && this.workflows.length > 0) {
        this.currentWorkflow = this.workflows[0].id;
      }
    } catch (e) {
      console.error('Failed to load workflows:', e);
    }
  }

  async loadRuns() {
    if (!this.currentWorkflow) return;
    try {
      this.runs = await api.getRuns(this.currentWorkflow);
      this.renderBoard();
    } catch (e) {
      console.error('Failed to load runs:', e);
    }
  }

  render() {
    this.container.innerHTML = `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">
        <select id="wf-select">
          <option>Loading...</option>
        </select>
        <span style="color:var(--text-secondary);font-size:13px">Select workflow to view runs</span>
      </div>
      <div id="board-container">
        <div style="text-align:center;padding:40px;color:var(--text-secondary)">
          Loading workflows...
        </div>
      </div>
    `;

    document.getElementById('wf-select')?.addEventListener('change', (e) => {
      this.currentWorkflow = e.target.value;
      this.loadRuns();
    });
  }

  renderBoard() {
    const container = document.getElementById('board-container');
    if (!container) return;

    const columns = [
      { id: 'pending', title: 'Pending', status: ['pending'] },
      { id: 'running', title: 'Running', status: ['running'] },
      { id: 'done', title: 'Completed', status: ['done', 'failed'] },
    ];

    const runsByColumn = {};
    columns.forEach(col => {
      runsByColumn[col.id] = this.runs.filter(r => col.status.includes(r.status));
    });

    container.innerHTML = `
      <div style="display:flex;gap:16px;overflow-x:auto">
        ${columns.map(col => `
          <div style="min-width:280px;flex:1;background:var(--bg-surface);border-radius:8px;box-shadow:0 2px 8px var(--shadow)">
            <div style="padding:12px 16px;border-bottom:1px solid var(--border-light);font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--accent-green);background:var(--bg-column-header);border-radius:8px 8px 0 0;display:flex;align-items:center;gap:8px">
              ${col.title}
              <span style="background:var(--accent-green);color:#fff;border-radius:10px;padding:1px 8px;font-size:11px">${runsByColumn[col.id].length}</span>
            </div>
            <div style="padding:8px;min-height:200px">
              ${runsByColumn[col.id].length === 0 ? `
                <div style="text-align:center;padding:40px;color:var(--text-secondary);font-size:13px">No runs</div>
              ` : runsByColumn[col.id].map(run => this.renderRunCard(run)).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Add click handlers
    container.querySelectorAll('.run-card').forEach(card => {
      card.addEventListener('click', () => {
        const runId = card.dataset.runId;
        window.location.hash = `#/runs/${runId}`;
      });
    });
  }

  renderRunCard(run) {
    const statusClass = run.status === 'done' ? 'badge-done' :
                       run.status === 'failed' ? 'badge-failed' :
                       run.status === 'running' ? 'badge-running' : 'badge-pending';
    const date = new Date(run.created_at).toLocaleString();

    return `
      <div class="run-card card" data-run-id="${this.escapeHtml(run.id)}" style="margin-bottom:8px">
        <div class="card-title">${this.escapeHtml(run.task || 'Untitled run')}</div>
        <div class="card-meta">
          <span>Run #${run.run_number}</span>
          <span class="badge ${statusClass}">${run.status}</span>
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">${date}</div>
      </div>
    `;
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  destroy() {
    // Cleanup if needed
  }
}
