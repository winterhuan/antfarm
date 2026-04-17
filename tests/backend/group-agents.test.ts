import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { groupAgentsByBackend } from '../../src/backend/group-agents.js';
import type { BackendType } from '../../src/backend/interface.js';
import type { WorkflowSpec, WorkflowAgent } from '../../src/installer/types.js';

// Mock config resolver
const mockResolveBackendConfig = vi.fn();
vi.mock('../../src/backend/config-resolver.js', () => ({
  resolveBackendConfig: (...args: unknown[]) => mockResolveBackendConfig(...args),
}));

describe('groupAgentsByBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should group agents by resolved backend type', async () => {
    const agents: WorkflowAgent[] = [
      { id: 'agent1', workspace: { baseDir: 'a1', files: {} } },
      { id: 'agent2', workspace: { baseDir: 'a2', files: {} } },
      { id: 'agent3', workspace: { baseDir: 'a3', files: {} } },
    ];
    const workflow: WorkflowSpec = {
      id: 'test-workflow',
      agents,
      steps: [],
    };

    // Mock resolver returns: agent1->openclaw, agent2->hermes, agent3->openclaw
    mockResolveBackendConfig.mockImplementation((agent: WorkflowAgent) => {
      if (agent.id === 'agent1') return Promise.resolve({ type: 'openclaw' as BackendType, source: 'default' });
      if (agent.id === 'agent2') return Promise.resolve({ type: 'hermes' as BackendType, source: 'default' });
      if (agent.id === 'agent3') return Promise.resolve({ type: 'openclaw' as BackendType, source: 'default' });
      return Promise.resolve({ type: 'openclaw' as BackendType, source: 'default' });
    });

    const result = await groupAgentsByBackend(workflow);

    expect(result.get('openclaw')).toHaveLength(2);
    expect(result.get('hermes')).toHaveLength(1);
    expect(result.get('openclaw')).toContain(agents[0]);
    expect(result.get('hermes')).toContain(agents[1]);
    expect(result.get('openclaw')).toContain(agents[2]);
  });

  it('should pass CLI backend to resolver', async () => {
    const agent: WorkflowAgent = { id: 'agent1', workspace: { baseDir: 'a1', files: {} } };
    const workflow: WorkflowSpec = {
      id: 'test-workflow',
      agents: [agent],
      steps: [],
    };

    mockResolveBackendConfig.mockResolvedValue({ type: 'hermes' as BackendType, source: 'cli' });

    await groupAgentsByBackend(workflow, 'hermes');

    expect(mockResolveBackendConfig).toHaveBeenCalledWith(agent, workflow, 'hermes');
  });

  it('should handle empty workflow', async () => {
    const workflow: WorkflowSpec = {
      id: 'test-workflow',
      agents: [],
      steps: [],
    };

    const result = await groupAgentsByBackend(workflow);

    expect(result.size).toBe(0);
  });

  it('should preserve agent order within each group', async () => {
    const agents: WorkflowAgent[] = [
      { id: 'agent1', workspace: { baseDir: 'a1', files: {} } },
      { id: 'agent2', workspace: { baseDir: 'a2', files: {} } },
      { id: 'agent3', workspace: { baseDir: 'a3', files: {} } },
      { id: 'agent4', workspace: { baseDir: 'a4', files: {} } },
    ];
    const workflow: WorkflowSpec = {
      id: 'test-workflow',
      agents,
      steps: [],
    };

    // All agents use openclaw - should preserve order
    mockResolveBackendConfig.mockResolvedValue({ type: 'openclaw' as BackendType, source: 'default' });

    const result = await groupAgentsByBackend(workflow);
    const openclawAgents = result.get('openclaw')!;

    expect(openclawAgents[0].id).toBe('agent1');
    expect(openclawAgents[1].id).toBe('agent2');
    expect(openclawAgents[2].id).toBe('agent3');
    expect(openclawAgents[3].id).toBe('agent4');
  });

  it('should handle all agents having same backend', async () => {
    const agents: WorkflowAgent[] = [
      { id: 'agent1', workspace: { baseDir: 'a1', files: {} } },
      { id: 'agent2', workspace: { baseDir: 'a2', files: {} } },
    ];
    const workflow: WorkflowSpec = {
      id: 'test-workflow',
      agents,
      steps: [],
    };

    mockResolveBackendConfig.mockResolvedValue({ type: 'hermes' as BackendType, source: 'default' });

    const result = await groupAgentsByBackend(workflow);

    expect(result.size).toBe(1);
    expect(result.has('hermes')).toBe(true);
    expect(result.get('hermes')).toHaveLength(2);
  });
});
