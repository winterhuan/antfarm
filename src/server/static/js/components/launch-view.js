// Launch view - Workflow run launcher
import { api } from '../api.js';

export class LaunchView {
  constructor(container) {
    this.container = container;
    this.workflows = [];
    this.config = null;
    this.selectedWorkflow = null;
    this.selectedBackend = 'hermes';
    this.showAdvanced = false;
    this.render();
    this.init();
  }

  async init() {
    await Promise.all([
      this.loadWorkflows(),
      this.loadConfig(),
    ]);
    this.renderForm();
  }

  async loadWorkflows() {
    try {
      this.workflows = await api.getWorkflows();
    } catch (e) {
      console.error('Failed to load workflows:', e);
    }
  }

  async loadConfig() {
    try {
      this.config = await api.getLaunchConfig();
      this.selectedBackend = this.config?.defaults?.backend || 'hermes';
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  }

  render() {
    this.container.innerHTML = `
      <div style="max-width:800px;margin:0 auto">
        <h2 style="font-size:24px;font-weight:600;margin-bottom:8px">Launch Workflow</h2>
        <p style="color:var(--text-secondary);margin-bottom:24px">Start a new workflow run with your configuration</p>

        <div id="launch-form-container">
          <div style="text-align:center;padding:40px;color:var(--text-secondary)">
            Loading...
          </div>
        </div>
      </div>
    `;
  }

  renderForm() {
    const container = document.getElementById('launch-form-container');
    if (!container) return;

    container.innerHTML = `
      <form id="launch-form" class="launch-form">
        <!-- Quick Start Section -->
        <div class="form-section">
          <div class="form-section-title">Quick Start</div>

          <div class="form-row">
            <label for="workflow-select">Workflow</label>
            <select id="workflow-select" required style="width:100%;padding:10px 12px">
              <option value="">Select a workflow...</option>
              ${this.workflows.map(w => `
                <option value="${this.escapeHtml(w.id)}" data-name="${this.escapeHtml(w.name)}">
                  ${this.escapeHtml(w.name)}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="form-row">
            <label for="task-input">Task Title</label>
            <textarea id="task-input" required rows="3" placeholder="Describe what you want to accomplish..."></textarea>
          </div>
        </div>

        <!-- Advanced Configuration -->
        <div class="form-section">
          <button type="button" class="advanced-toggle" id="advanced-toggle">
            <span id="advanced-icon">▶</span> Advanced Configuration
          </button>

          <div id="advanced-content" class="advanced-content" style="display:none">
            <div class="form-row">
              <label>Backend</label>
              <div class="radio-group">
                ${(this.config?.backends || ['hermes', 'claude-code', 'codex', 'openclaw']).map(b => `
                  <div class="radio-item ${b === this.selectedBackend ? 'selected' : ''}" data-backend="${b}">
                    <input type="radio" name="backend" value="${b}" ${b === this.selectedBackend ? 'checked' : ''}>
                    <span style="flex:1">${this.escapeHtml(b)}</span>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="form-row">
              <label for="model-select">Model (optional)</label>
              <select id="model-select">
                <option value="">Default</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="claude-sonnet">Claude Sonnet</option>
                <option value="claude-opus">Claude Opus</option>
              </select>
            </div>

            <div class="form-row">
              <label for="timeout-input">Timeout (seconds)</label>
              <input type="number" id="timeout-input" value="1800" min="60" max="7200">
            </div>

            <div class="form-row">
              <label for="notify-input">Notify URL (optional)</label>
              <input type="url" id="notify-input" placeholder="https://...">
            </div>
          </div>
        </div>

        <!-- Submit -->
        <div style="display:flex;gap:12px;justify-content:flex-end">
          <button type="button" class="btn btn-secondary" id="validate-btn">Validate</button>
          <button type="submit" class="btn" style="min-width:120px" id="launch-btn">▶ Start Run</button>
        </div>

        <!-- Status/Result -->
        <div id="launch-status" style="margin-top:16px;padding:12px 16px;border-radius:6px;display:none"></div>
      </form>
    `;

    this.attachHandlers();
  }

  attachHandlers() {
    const form = document.getElementById('launch-form');
    const advancedToggle = document.getElementById('advanced-toggle');
    const advancedContent = document.getElementById('advanced-content');
    const validateBtn = document.getElementById('validate-btn');
    const workflowSelect = document.getElementById('workflow-select');

    // Advanced toggle
    advancedToggle?.addEventListener('click', () => {
      this.showAdvanced = !this.showAdvanced;
      advancedContent.style.display = this.showAdvanced ? 'block' : 'none';
      document.getElementById('advanced-icon').textContent = this.showAdvanced ? '▼' : '▶';
    });

    // Backend selection
    document.querySelectorAll('.radio-item').forEach(item => {
      item.addEventListener('click', () => {
        const backend = item.dataset.backend;
        document.querySelectorAll('.radio-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        item.querySelector('input[type="radio"]').checked = true;
        this.selectedBackend = backend;
      });
    });

    // Workflow selection - auto-fill defaults
    workflowSelect?.addEventListener('change', (e) => {
      this.selectedWorkflow = this.workflows.find(w => w.id === e.target.value);
    });

    // Validate button
    validateBtn?.addEventListener('click', async () => {
      const data = this.getFormData();
      if (!data.workflowId) {
        this.showStatus('Please select a workflow', 'error');
        return;
      }
      if (!data.taskTitle.trim()) {
        this.showStatus('Please enter a task title', 'error');
        return;
      }

      validateBtn.disabled = true;
      validateBtn.textContent = 'Validating...';

      try {
        const result = await api.validateLaunch(data);
        if (result.valid) {
          this.showStatus('✓ Configuration valid', 'success');
        } else {
          const errors = result.errors?.join(', ') || 'Validation failed';
          this.showStatus(`✗ ${errors}`, 'error');
        }
      } catch (e) {
        this.showStatus(`Error: ${e.message}`, 'error');
      } finally {
        validateBtn.disabled = false;
        validateBtn.textContent = 'Validate';
      }
    });

    // Form submit
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = this.getFormData();

      if (!data.workflowId) {
        this.showStatus('Please select a workflow', 'error');
        return;
      }
      if (!data.taskTitle.trim()) {
        this.showStatus('Please enter a task title', 'error');
        return;
      }

      const launchBtn = document.getElementById('launch-btn');
      launchBtn.disabled = true;
      launchBtn.textContent = 'Starting...';

      try {
        const result = await api.launch(data);
        this.showStatus(`✓ Run started! Run #${result.run?.runNumber || 'N/A'}`, 'success');

        // Redirect to board after short delay
        setTimeout(() => {
          window.location.hash = '#/board';
        }, 1500);
      } catch (e) {
        this.showStatus(`Error: ${e.message}`, 'error');
      } finally {
        launchBtn.disabled = false;
        launchBtn.textContent = '▶ Start Run';
      }
    });
  }

  getFormData() {
    const workflowSelect = document.getElementById('workflow-select');
    const taskInput = document.getElementById('task-input');
    const modelSelect = document.getElementById('model-select');
    const timeoutInput = document.getElementById('timeout-input');
    const notifyInput = document.getElementById('notify-input');
    const backendRadio = document.querySelector('input[name="backend"]:checked');

    return {
      workflowId: workflowSelect?.value || '',
      taskTitle: taskInput?.value?.trim() || '',
      backend: backendRadio?.value || this.selectedBackend,
      model: modelSelect?.value || undefined,
      timeoutSeconds: parseInt(timeoutInput?.value || '1800', 10),
      notifyUrl: notifyInput?.value?.trim() || undefined,
    };
  }

  showStatus(message, type) {
    const statusEl = document.getElementById('launch-status');
    if (!statusEl) return;

    statusEl.style.display = 'block';
    statusEl.style.background = type === 'success' ? 'var(--accent-green-subtle)' :
                                 type === 'error' ? '#fee' :
                                 'var(--accent-teal-subtle)';
    statusEl.style.color = type === 'success' ? 'var(--accent-green)' :
                           type === 'error' ? 'var(--accent-orange)' :
                           'var(--text-primary)';
    statusEl.style.border = `1px solid ${type === 'success' ? 'var(--accent-green)' :
                                          type === 'error' ? 'var(--accent-orange)' :
                                          'var(--border)'}`;
    statusEl.textContent = message;
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
