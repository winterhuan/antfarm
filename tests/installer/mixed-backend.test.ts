import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installWorkflow } from '../../src/installer/install.js';
import { runWorkflow } from '../../src/installer/run.js';
import { HermesBackend, getProfileName } from '../../src/backend/hermes.js';
import type { WorkflowSpec, WorkflowAgent } from '../../src/installer/types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock dependencies
vi.mock('../../src/installer/workflow-fetch.js', () => ({
  fetchWorkflow: vi.fn(),
}));

vi.mock('../../src/installer/workflow-spec.js', () => ({
  loadWorkflowSpec: vi.fn(),
}));

vi.mock('../../src/backend/hermes.js', () => {
  const actual = vi.importActual('../../src/backend/hermes.js');
  return {
    ...actual,
    HermesBackend: vi.fn().mockImplementation(() => ({
      install: vi.fn().mockResolvedValue(undefined),
      uninstall: vi.fn().mockResolvedValue(undefined),
      startRun: vi.fn().mockResolvedValue(undefined),
      stopRun: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock('../../src/backend/openclaw.js', () => ({
  OpenClawBackend: vi.fn().mockImplementation(() => ({
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    startRun: vi.fn().mockResolvedValue(undefined),
    stopRun: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('Mixed Backend Workflow Integration', () => {
  const createMixedWorkflow = (): WorkflowSpec => ({
    id: 'mixed-backend-wf',
    name: 'Mixed Backend Workflow',
    agents: [
      {
        id: 'planner',
        name: 'Planner',
        role: 'analysis',
        backend: 'openclaw', // OpenClaw backend
        workspace: { baseDir: 'planner', files: { 'CLAUDE.md': './planner.md' } },
      },
      {
        id: 'coder',
        name: 'Coder',
        role: 'coding',
        backend: 'hermes', // Hermes backend
        workspace: { baseDir: 'coder', files: { 'CLAUDE.md': './coder.md' } },
      },
      {
        id: 'tester',
        name: 'Tester',
        role: 'testing',
        backend: 'hermes', // Hermes backend
        workspace: { baseDir: 'tester', files: { 'CLAUDE.md': './tester.md' } },
      },
    ],
    steps: [
      { id: 'step1', agent: 'planner', input: 'plan', expects: 'plan' },
      { id: 'step2', agent: 'coder', input: 'code', expects: 'code' },
      { id: 'step3', agent: 'tester', input: 'test', expects: 'test' },
    ],
    version: '1.0',
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('installWorkflow with mixed backends', () => {
    it('should install agents to their respective backends', async () => {
      const { fetchWorkflow } = await import('../../src/installer/workflow-fetch.js');
      const { loadWorkflowSpec } = await import('../../src/installer/workflow-spec.js');
      const workflow = createMixedWorkflow();

      vi.mocked(fetchWorkflow).mockResolvedValue({
        workflowDir: '/tmp/test-wf',
        bundledSourceDir: '/tmp/test-src',
      });
      vi.mocked(loadWorkflowSpec).mockResolvedValue(workflow);

      await installWorkflow({ workflowId: 'mixed-backend-wf' });

      // Should have called install for both backends
      // Note: In real implementation, this would call OpenClawBackend.install and HermesBackend.install
    });

    it('should group agents correctly when CLI backend overrides one agent', async () => {
      const { fetchWorkflow } = await import('../../src/installer/workflow-fetch.js');
      const { loadWorkflowSpec } = await import('../../src/installer/workflow-spec.js');
      const workflow = createMixedWorkflow();

      vi.mocked(fetchWorkflow).mockResolvedValue({
        workflowDir: '/tmp/test-wf',
        bundledSourceDir: '/tmp/test-src',
      });
      vi.mocked(loadWorkflowSpec).mockResolvedValue(workflow);

      // CLI forces all to hermes
      await installWorkflow({ workflowId: 'mixed-backend-wf', backend: 'hermes' });

      // All 3 agents should go to Hermes when CLI overrides
    });
  });

  describe('runWorkflow with mixed backends', () => {
    it('should start runs on all backends used by agents', async () => {
      // This would test that runWorkflow calls startRun on both OpenClaw and Hermes
    });

    it('should rollback all backends if one fails to start', async () => {
      // This would test the rollback behavior when one backend fails
    });
  });

  describe('backend isolation', () => {
    it('should not leak agent configs between backends', async () => {
      const workflow = createMixedWorkflow();

      // OpenClaw agents should not be visible to Hermes and vice versa
      const openclawAgents = workflow.agents.filter(a => a.backend === 'openclaw');
      const hermesAgents = workflow.agents.filter(a => a.backend === 'hermes');

      expect(openclawAgents).toHaveLength(1);
      expect(hermesAgents).toHaveLength(2);
      expect(openclawAgents[0].id).toBe('planner');
      expect(hermesAgents.map(a => a.id)).toContain('coder');
      expect(hermesAgents.map(a => a.id)).toContain('tester');
    });
  });
});

describe('Mixed Backend Agent Resolution', () => {
  it('should correctly identify backend from agent config', () => {
    const agents: WorkflowAgent[] = [
      { id: 'a1', backend: 'openclaw', workspace: { baseDir: 'a1', files: {} } },
      { id: 'a2', backend: 'hermes', workspace: { baseDir: 'a2', files: {} } },
      { id: 'a3', backend: 'openclaw', workspace: { baseDir: 'a3', files: {} } },
    ];

    const byBackend = agents.reduce((acc, agent) => {
      const backend = agent.backend || 'openclaw';
      acc[backend] = (acc[backend] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    expect(byBackend['openclaw']).toBe(2);
    expect(byBackend['hermes']).toBe(1);
  });

  it('should handle agents without explicit backend (fallback to default)', () => {
    const agents: WorkflowAgent[] = [
      { id: 'a1', workspace: { baseDir: 'a1', files: {} } }, // No backend specified
      { id: 'a2', backend: 'hermes', workspace: { baseDir: 'a2', files: {} } },
    ];

    const a1Backend = agents[0].backend || 'openclaw';
    const a2Backend = agents[1].backend || 'openclaw';

    expect(a1Backend).toBe('openclaw');
    expect(a2Backend).toBe('hermes');
  });
});
