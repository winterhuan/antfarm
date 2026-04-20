// Agents view - Agent management page
import { api } from '../api.js';

export class AgentsView {
  constructor(container) {
    this.container = container;
    this.workflows = [];
    this.backends = [];
    this.agents = [];
    this.viewMode = 'workflow'; // 'workflow' or 'backend'
    this.render();
    this.init();
  }

  async init() {
    await Promise.all([
      this.loadWorkflows(),
      this.loadBackends(),
    ]);
    await this.loadAgents();
  }

  async loadWorkflows() {
    try {
      this.workflows = await api.getWorkflows();
    } catch (e) {
      console.error('Failed to load workflows:', e);
    }
  }

  async loadBackends() {
    try {
      this.backends = await api.getBackends();
    } catch (e) {
      console.error('Failed to load backends:', e);
    }
  }

  async loadAgents() {
    try {
      // Load agents from all workflows
      const promises = this.workflows.map(wf => api.getAgents(wf.id));
      const results = await Promise.all(promises);
      this.agents = results.flat();
      this.renderAgents();
    } catch (e) {
      console.error('Failed to load agents:', e);
    }
  }

  render() {
    this.container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
        <h2 style="font-size:20px;font-weight:600">Agent Management</h2>
        <div style="display:flex;gap:12px;align-items:center">
          <select id="view-mode-select" style="background:var(--bg-surface);color:var(--text-primary);border-color:var(--border)">
            <option value="workflow">Group by Workflow</option>
            <option value="backend">Group by Backend</option>
          </select>
          <button id="refresh-agents" class="btn btn-secondary">Refresh</button>
        </div>
      </div>

      <div id="agents-container">
        <div style="text-align:center;padding:40px;color:var(--text-secondary)">
          Loading agents...
        </div>
      </div>
    `;

    document.getElementById('view-mode-select')?.addEventListener('change', (e) => {
      this.viewMode = e.target.value;
      this.renderAgents();
    });

    document.getElementById('refresh-agents')?.addEventListener('click', () => {
      this.loadAgents();
    });
  }

  renderAgents() {
    const container = document.getElementById('agents-container');
    if (!container) return;

    if (this.agents.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:60px;color:var(--text-secondary)">
          <div style="font-size:48px;margin-bottom:16px">🤖</div>
          <div style="font-size:16px;font-weight:500;margin-bottom:8px">No agents found</div>
          <div>Install a workflow to see agents here</div>
        </div>
      `;
      return;
    }

    if (this.viewMode === 'workflow') {
      this.renderByWorkflow(container);
    } else {
      this.renderByBackend(container);
    }
  }

  renderByWorkflow(container) {
    const grouped = this.groupBy(this.agents, 'workflowId');

    container.innerHTML = Object.entries(grouped).map(([workflowId, agents]) => `
      <div style="margin-bottom:24px">
        <h3 style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">
          ${this.escapeHtml(this.getWorkflowName(workflowId))}
          <span style="font-size:13px;font-weight:400;color:var(--text-secondary);margin-left:8px">(${agents.length} agents)</span>
        </h3>
        <div class="grid grid-3">
          ${agents.map(agent => this.renderAgentCard(agent)).join('')}
        </div>
      </div>
    `).join('');

    this.attachAgentHandlers(container);
  }

  renderByBackend(container) {
    const grouped = this.groupBy(this.agents, 'backend');

    container.innerHTML = Object.entries(grouped).map(([backend, agents]) => `
      <div style="margin-bottom:24px">
        <h3 style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
          ${this.getBackendIcon(backend)}
          ${this.escapeHtml(backend)}
          <span style="font-size:13px;font-weight:400;color:var(--text-secondary)">(${agents.length} agents)</span>
        </h3>
        <div class="grid grid-3">
          ${agents.map(agent => this.renderAgentCard(agent)).join('')}
        </div>
      </div>
    `).join('');

    this.attachAgentHandlers(container);
  }

  renderAgentCard(agent) {
    const statusClass = agent.state === 'active' ? 'active' :
                       agent.state === 'error' ? 'error' : 'inactive';
    const backendIcon = this.getBackendIcon(agent.backend);

    return `
      <div class="agent-card" data-agent-id="${this.escapeHtml(agent.id)}">
        <div class="agent-header">
          <div class="agent-icon">${backendIcon}</div>
          <div class="agent-title">
            <div class="agent-name">${this.escapeHtml(agent.name)}</div>
            <div class="agent-meta">
              <span class="status-dot ${statusClass}"></span>
              ${this.escapeHtml(agent.state)}
            </div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
          <div>Backend: ${this.escapeHtml(agent.backend)}</div>
          ${agent.details?.model ? `<div>Model: ${this.escapeHtml(agent.details.model)}</div>` : ''}
          ${agent.details?.role ? `<div>Role: ${this.escapeHtml(agent.details.role)}</div>` : ''}
        </div>
        <div class="agent-actions">
          ${agent.state === 'active' ?
            `<button class="btn btn-danger btn-sm" data-action="stop">Stop</button>` :
            `<button class="btn btn-sm" data-action="start">Start</button>`
          }
        </div>
      </div>
    `;
  }

  attachAgentHandlers(container) {
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const card = e.target.closest('.agent-card');
        const agentId = card?.dataset.agentId;
        const action = e.target.dataset.action;

        if (agentId && action) {
          e.target.disabled = true;
          e.target.textContent = action === 'start' ? 'Starting...' : 'Stopping...';

          try {
            if (action === 'start') {
              await api.startAgent(agentId);
            } else {
              await api.stopAgent(agentId);
            }
            // Refresh after action
            await this.loadAgents();
          } catch (err) {
            alert(`Failed to ${action} agent: ${err.message}`);
            e.target.disabled = false;
            e.target.textContent = action === 'start' ? 'Start' : 'Stop';
          }
        }
      });
    });
  }

  groupBy(array, key) {
    return array.reduce((result, item) => {
      const group = item[key] || 'unknown';
      (result[group] = result[group] || []).push(item);
      return result;
    }, {});
  }

  getWorkflowName(id) {
    const wf = this.workflows.find(w => w.id === id);
    return wf?.name || id;
  }

  getBackendIcon(backend) {
    const icons = {
      'hermes': '🔱',
      'claude-code': '🅒',
      'codex': '🅧',
      'openclaw': '🐾',
    };
    return icons[backend] || '🤖';
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
