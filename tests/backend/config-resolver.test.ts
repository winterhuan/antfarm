import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveBackendConfig, validateBackendType } from '../../src/backend/config-resolver.js';
import type { WorkflowSpec, WorkflowAgent } from '../../src/installer/types.js';

// Mock the config module
vi.mock('../../src/lib/config.js', () => ({
  readAntfarmConfig: vi.fn().mockResolvedValue({}),
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
      const { readAntfarmConfig } = await import('../../src/lib/config.js');
      vi.mocked(readAntfarmConfig).mockResolvedValue({ defaultBackend: 'hermes' });
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
});

describe('validateBackendType', () => {
  it('should accept valid backend types', () => {
    expect(validateBackendType('openclaw')).toBe('openclaw');
    expect(validateBackendType('hermes')).toBe('hermes');
  });

  it('should throw for invalid backend types', () => {
    expect(() => validateBackendType('invalid')).toThrow('Unknown backend type');
  });
});
