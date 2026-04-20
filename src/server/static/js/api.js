// API client for Antfarm Dashboard
const API_BASE = '';

async function fetchJSON(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Accept': 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Workflows
  async getWorkflows() {
    return fetchJSON('/api/workflows');
  },

  // Runs
  async getRuns(workflowId) {
    const url = workflowId ? `/api/runs?workflow=${encodeURIComponent(workflowId)}` : '/api/runs';
    return fetchJSON(url);
  },

  async getRun(runId) {
    return fetchJSON(`/api/runs/${runId}`);
  },

  async getRunEvents(runId) {
    return fetchJSON(`/api/runs/${runId}/events`);
  },

  async getRunStories(runId) {
    return fetchJSON(`/api/runs/${runId}/stories`);
  },

  // Agents
  async getAgents(workflowId) {
    const url = workflowId ? `/api/agents?workflow=${encodeURIComponent(workflowId)}` : '/api/agents';
    return fetchJSON(url);
  },

  async getAgentsByBackend(backend, workflowId) {
    const url = workflowId
      ? `/api/agents/by-backend/${backend}?workflow=${encodeURIComponent(workflowId)}`
      : `/api/agents/by-backend/${backend}`;
    return fetchJSON(url);
  },

  async startAgent(agentId) {
    return fetchJSON(`/api/agents/${agentId}/start`, { method: 'POST' });
  },

  async stopAgent(agentId) {
    return fetchJSON(`/api/agents/${agentId}/stop`, { method: 'POST' });
  },

  // Backends
  async getBackends() {
    return fetchJSON('/api/backends');
  },

  // Launch
  async getLaunchConfig() {
    return fetchJSON('/api/config');
  },

  async validateLaunch(data) {
    return fetchJSON('/api/launch/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  },

  async launch(data) {
    return fetchJSON('/api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  },

  // Medic
  async getMedicStatus() {
    return fetchJSON('/api/medic/status');
  },

  async getMedicChecks(limit = 20) {
    return fetchJSON(`/api/medic/checks?limit=${limit}`);
  }
};
