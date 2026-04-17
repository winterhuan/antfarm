import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveBackendConfig, validateBackendType } from '../../src/backend/config-resolver.js';
import type { WorkflowSpec, WorkflowAgent } from '../../src/installer/types.js';

// Mock the config module
const mockReadAntfarmConfig = vi.fn();
vi.mock('../../src/lib/config.js', () => ({
  readAntfarmConfig: (...args: unknown[]) => mockReadAntfarmConfig(...args),
  DEFAULT_BACKEND: 'openclaw',
}));

describe('resolveBackendConfig', () => {
  const baseAgent: WorkflowAgent = {
    id: 'test-agent',
    workspace: { baseDir: 'test', files: {} },
  };

  const baseWorkflow: WorkflowSpec = {
    id: 'test-workflow',
    agents: [baseAgent],
    steps: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadAntfarmConfig.mockResolvedValue({});
  });

  describe('priority hierarchy', () => {
    it('should use CLI backend when provided', async () => {
      const result = await resolveBackendConfig(baseAgent, baseWorkflow, 'hermes');
      expect(result.type).toBe('hermes');
      expect(result.source).toBe('cli');
    });

    it('should use agent backend when CLI not provided', async () => {
      const agentWithBackend: WorkflowAgent = { ...baseAgent, backend: 'hermes' };
      const result = await resolveBackendConfig(agentWithBackend, baseWorkflow);
      expect(result.type).toBe('hermes');
      expect(result.source).toBe('agent');
    });

    it('should use workflow default when agent backend not set', async () => {
      const workflowWithDefault: WorkflowSpec = { ...baseWorkflow, defaultBackend: 'hermes' };
      const result = await resolveBackendConfig(baseAgent, workflowWithDefault);
      expect(result.type).toBe('hermes');
      expect(result.source).toBe('workflow');
    });

    it('should use global config when set', async () => {
      mockReadAntfarmConfig.mockResolvedValue({ defaultBackend: 'hermes' });
      const result = await resolveBackendConfig(baseAgent, baseWorkflow);
      expect(result.type).toBe('hermes');
      expect(result.source).toBe('global');
    });

    it('should use default when no other config set', async () => {
      const result = await resolveBackendConfig(baseAgent, baseWorkflow);
      expect(result.type).toBe('openclaw');
      expect(result.source).toBe('default');
    });
  });

  describe('CLI vs agent combinations', () => {
    it('CLI should override agent-specific backend', async () => {
      const hermesAgent: WorkflowAgent = { ...baseAgent, backend: 'hermes' };
      // CLI specifies openclaw, agent specifies hermes
      const result = await resolveBackendConfig(hermesAgent, baseWorkflow, 'openclaw');
      expect(result.type).toBe('openclaw');
      expect(result.source).toBe('cli');
    });

    it('CLI should override workflow default', async () => {
      const workflowWithDefault: WorkflowSpec = { ...baseWorkflow, defaultBackend: 'hermes' };
      const result = await resolveBackendConfig(baseAgent, workflowWithDefault, 'openclaw');
      expect(result.type).toBe('openclaw');
      expect(result.source).toBe('cli');
    });

    it('CLI should override global config', async () => {
      mockReadAntfarmConfig.mockResolvedValue({ defaultBackend: 'hermes' });
      const result = await resolveBackendConfig(baseAgent, baseWorkflow, 'openclaw');
      expect(result.type).toBe('openclaw');
      expect(result.source).toBe('cli');
    });

    it('different agents can have different backends without CLI', async () => {
      const openclawAgent: WorkflowAgent = { ...baseAgent, id: 'agent1', backend: 'openclaw' };
      const hermesAgent: WorkflowAgent = { ...baseAgent, id: 'agent2', backend: 'hermes' };

      const result1 = await resolveBackendConfig(openclawAgent, baseWorkflow);
      const result2 = await resolveBackendConfig(hermesAgent, baseWorkflow);

      expect(result1.type).toBe('openclaw');
      expect(result1.source).toBe('agent');
      expect(result2.type).toBe('hermes');
      expect(result2.source).toBe('agent');
    });
  });

  describe('global config edge cases', () => {
    it('should handle empty global config file', async () => {
      mockReadAntfarmConfig.mockResolvedValue({});
      const result = await resolveBackendConfig(baseAgent, baseWorkflow);
      expect(result.type).toBe('openclaw');
      expect(result.source).toBe('default');
    });

    it('should handle null global config', async () => {
      mockReadAntfarmConfig.mockResolvedValue(null);
      const result = await resolveBackendConfig(baseAgent, baseWorkflow);
      expect(result.type).toBe('openclaw');
      expect(result.source).toBe('default');
    });

    it('should handle global config with undefined defaultBackend', async () => {
      mockReadAntfarmConfig.mockResolvedValue({ defaultBackend: undefined });
      const result = await resolveBackendConfig(baseAgent, baseWorkflow);
      expect(result.type).toBe('openclaw');
      expect(result.source).toBe('default');
    });

    it('should use workflow default over global when agent has no backend', async () => {
      mockReadAntfarmConfig.mockResolvedValue({ defaultBackend: 'openclaw' });
      const workflowWithDefault: WorkflowSpec = { ...baseWorkflow, defaultBackend: 'hermes' };
      const result = await resolveBackendConfig(baseAgent, workflowWithDefault);
      expect(result.type).toBe('hermes');
      expect(result.source).toBe('workflow');
    });
  });

  describe('priority chain: CLI > agent > workflow > global > default', () => {
    it('full priority chain: CLI wins over all', async () => {
      mockReadAntfarmConfig.mockResolvedValue({ defaultBackend: 'openclaw' });
      const workflowWithDefault: WorkflowSpec = { ...baseWorkflow, defaultBackend: 'hermes' };
      const agentWithBackend: WorkflowAgent = { ...baseAgent, backend: 'openclaw' };

      const result = await resolveBackendConfig(agentWithBackend, workflowWithDefault, 'hermes');
      expect(result.type).toBe('hermes');
      expect(result.source).toBe('cli');
    });

    it('full priority chain: agent wins over workflow, global, default', async () => {
      mockReadAntfarmConfig.mockResolvedValue({ defaultBackend: 'openclaw' });
      const workflowWithDefault: WorkflowSpec = { ...baseWorkflow, defaultBackend: 'hermes' };
      const agentWithBackend: WorkflowAgent = { ...baseAgent, backend: 'openclaw' };

      const result = await resolveBackendConfig(agentWithBackend, workflowWithDefault);
      expect(result.type).toBe('openclaw');
      expect(result.source).toBe('agent');
    });

    it('full priority chain: workflow wins over global and default', async () => {
      mockReadAntfarmConfig.mockResolvedValue({ defaultBackend: 'openclaw' });
      const workflowWithDefault: WorkflowSpec = { ...baseWorkflow, defaultBackend: 'hermes' };

      const result = await resolveBackendConfig(baseAgent, workflowWithDefault);
      expect(result.type).toBe('hermes');
      expect(result.source).toBe('workflow');
    });

    it('full priority chain: global wins over default', async () => {
      mockReadAntfarmConfig.mockResolvedValue({ defaultBackend: 'hermes' });

      const result = await resolveBackendConfig(baseAgent, baseWorkflow);
      expect(result.type).toBe('hermes');
      expect(result.source).toBe('global');
    });
  });
});

describe('validateBackendType', () => {
  it('should accept valid backend types', () => {
    expect(validateBackendType('openclaw')).toBe('openclaw');
    expect(validateBackendType('hermes')).toBe('hermes');
  });

  it('should throw for invalid backend types', () => {
    expect(() => validateBackendType('invalid')).toThrow('Unknown backend type');
  });

  it('should throw for empty string', () => {
    expect(() => validateBackendType('')).toThrow('Unknown backend type');
  });

  it('should throw for similar but invalid names', () => {
    expect(() => validateBackendType('openclaw2')).toThrow('Unknown backend type');
    expect(() => validateBackendType('hermess')).toThrow('Unknown backend type');
    expect(() => validateBackendType('OpenClaw')).toThrow('Unknown backend type'); // case sensitive
    expect(() => validateBackendType('Hermes')).toThrow('Unknown backend type'); // case sensitive
  });
});
