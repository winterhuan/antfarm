import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowSpec, WorkflowAgent } from '../../src/installer/types.js';
import { groupAgentsByBackend } from '../../src/backend/group-agents.js';

// Default global config resolves to {} — individual tests can override
vi.mock('../../src/lib/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/config.js')>(
    '../../src/lib/config.js',
  );
  return {
    ...actual,
    readAntfarmConfig: vi.fn().mockResolvedValue({}),
  };
});

function makeAgent(id: string, backend?: 'openclaw' | 'hermes'): WorkflowAgent {
  return {
    id,
    name: id,
    role: 'coding',
    workspace: { baseDir: id, files: {} },
    ...(backend ? { backend } : {}),
  };
}

function makeWorkflow(agents: WorkflowAgent[], defaultBackend?: 'openclaw' | 'hermes'): WorkflowSpec {
  return {
    id: 'mixed-wf',
    name: 'Mixed Workflow',
    agents,
    steps: agents.map((a) => ({ id: `step-${a.id}`, agent: a.id, input: 'x', expects: 'y' })),
    version: 1,
    ...(defaultBackend ? { defaultBackend } : {}),
  };
}

describe('groupAgentsByBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups agents by their explicit backend field', async () => {
    const workflow = makeWorkflow([
      makeAgent('planner', 'openclaw'),
      makeAgent('coder', 'hermes'),
      makeAgent('tester', 'hermes'),
    ]);

    const groups = await groupAgentsByBackend(workflow);

    expect(groups.size).toBe(2);
    expect(groups.get('openclaw')?.map((a) => a.id)).toEqual(['planner']);
    expect(groups.get('hermes')?.map((a) => a.id)).toEqual(['coder', 'tester']);
  });

  it('falls back to workflow defaultBackend when agent has none', async () => {
    const workflow = makeWorkflow(
      [
        makeAgent('planner'), // no backend → workflow default
        makeAgent('coder', 'hermes'),
      ],
      'openclaw',
    );

    const groups = await groupAgentsByBackend(workflow);

    expect(groups.get('openclaw')?.map((a) => a.id)).toEqual(['planner']);
    expect(groups.get('hermes')?.map((a) => a.id)).toEqual(['coder']);
  });

  it('respects global config default when workflow and agent are unset', async () => {
    const { readAntfarmConfig } = await import('../../src/lib/config.js');
    vi.mocked(readAntfarmConfig).mockResolvedValue({ defaultBackend: 'hermes' });

    const workflow = makeWorkflow([makeAgent('planner')]);
    const groups = await groupAgentsByBackend(workflow);

    expect(groups.get('hermes')?.map((a) => a.id)).toEqual(['planner']);
    expect(groups.has('openclaw')).toBe(false);
  });

  it('CLI override wins over every other source', async () => {
    const workflow = makeWorkflow(
      [
        makeAgent('planner', 'openclaw'),
        makeAgent('coder', 'hermes'),
      ],
      'openclaw',
    );

    const groups = await groupAgentsByBackend(workflow, 'hermes');

    expect(groups.size).toBe(1);
    expect(groups.get('hermes')?.map((a) => a.id)).toEqual(['planner', 'coder']);
  });

  it('preserves original agent order within each backend group', async () => {
    const workflow = makeWorkflow([
      makeAgent('a', 'hermes'),
      makeAgent('b', 'openclaw'),
      makeAgent('c', 'hermes'),
      makeAgent('d', 'openclaw'),
      makeAgent('e', 'hermes'),
    ]);

    const groups = await groupAgentsByBackend(workflow);

    expect(groups.get('hermes')?.map((a) => a.id)).toEqual(['a', 'c', 'e']);
    expect(groups.get('openclaw')?.map((a) => a.id)).toEqual(['b', 'd']);
  });

  it('returns empty map for empty workflow', async () => {
    const workflow = makeWorkflow([]);
    const groups = await groupAgentsByBackend(workflow);
    expect(groups.size).toBe(0);
  });
});

describe('runWorkflow mixed-backend integration', () => {
  // Ensure vitest resets module state between mocks
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function loadRunWithMocks(opts: {
    openclawStart?: () => Promise<void>;
    hermesStart?: () => Promise<void>;
    openclawStop?: () => Promise<void>;
    hermesStop?: () => Promise<void>;
  }) {
    const openclawStart = opts.openclawStart ?? (async () => {});
    const hermesStart = opts.hermesStart ?? (async () => {});
    const openclawStop = opts.openclawStop ?? (async () => {});
    const hermesStop = opts.hermesStop ?? (async () => {});

    const openclawStartSpy = vi.fn(openclawStart);
    const hermesStartSpy = vi.fn(hermesStart);
    const openclawStopSpy = vi.fn(openclawStop);
    const hermesStopSpy = vi.fn(hermesStop);

    vi.doMock('../../src/backend/index.js', () => ({
      createBackend: vi.fn((type: 'openclaw' | 'hermes') => {
        if (type === 'openclaw') {
          return {
            install: vi.fn().mockResolvedValue(undefined),
            uninstall: vi.fn().mockResolvedValue(undefined),
            startRun: openclawStartSpy,
            stopRun: openclawStopSpy,
          };
        }
        return {
          install: vi.fn().mockResolvedValue(undefined),
          uninstall: vi.fn().mockResolvedValue(undefined),
          startRun: hermesStartSpy,
          stopRun: hermesStopSpy,
        };
      }),
      groupAgentsByBackend: vi.fn(async (workflow: WorkflowSpec) => {
        const groups = new Map<'openclaw' | 'hermes', WorkflowAgent[]>();
        for (const agent of workflow.agents) {
          const backend = agent.backend || workflow.defaultBackend || 'openclaw';
          const list = groups.get(backend as 'openclaw' | 'hermes') ?? [];
          list.push(agent);
          groups.set(backend as 'openclaw' | 'hermes', list);
        }
        return groups;
      }),
    }));

    vi.doMock('../../src/installer/workflow-spec.js', () => ({
      loadWorkflowSpec: vi.fn().mockResolvedValue(
        makeWorkflow([
          makeAgent('planner', 'openclaw'),
          makeAgent('coder', 'hermes'),
          makeAgent('tester', 'hermes'),
        ]),
      ),
    }));

    vi.doMock('../../src/installer/paths.js', () => ({
      resolveWorkflowDir: () => '/tmp/test-wf',
    }));

    // Use an in-memory sqlite stub
    const stmts = {
      insertRun: { run: vi.fn() },
      insertStep: { run: vi.fn() },
      updateRun: { run: vi.fn() },
    };
    const dbExec = vi.fn();
    const dbPrepare = vi.fn((sql: string) => {
      if (sql.startsWith('INSERT INTO runs')) return stmts.insertRun;
      if (sql.startsWith('INSERT INTO steps')) return stmts.insertStep;
      if (sql.startsWith('UPDATE runs')) return stmts.updateRun;
      return { run: vi.fn() };
    });
    vi.doMock('../../src/db.js', () => ({
      getDb: () => ({ exec: dbExec, prepare: dbPrepare }),
      nextRunNumber: () => 1,
    }));

    vi.doMock('../../src/installer/events.js', () => ({
      emitEvent: vi.fn(),
    }));

    vi.doMock('../../src/lib/logger.js', () => ({
      logger: { info: vi.fn() },
    }));

    const { runWorkflow } = await import('../../src/installer/run.js');
    return {
      runWorkflow,
      spies: { openclawStartSpy, hermesStartSpy, openclawStopSpy, hermesStopSpy },
      stmts,
    };
  }

  it('starts all backends used by agents', async () => {
    const { runWorkflow, spies } = await loadRunWithMocks({});

    await runWorkflow({ workflowId: 'mixed-wf', taskTitle: 'test' });

    expect(spies.openclawStartSpy).toHaveBeenCalledTimes(1);
    expect(spies.hermesStartSpy).toHaveBeenCalledTimes(1);

    // OpenClaw should be called with only its agent
    const openclawWf = spies.openclawStartSpy.mock.calls[0][0] as WorkflowSpec;
    expect(openclawWf.agents.map((a) => a.id)).toEqual(['planner']);

    // Hermes should be called with both of its agents
    const hermesWf = spies.hermesStartSpy.mock.calls[0][0] as WorkflowSpec;
    expect(hermesWf.agents.map((a) => a.id)).toEqual(['coder', 'tester']);
  });

  it('rolls back already-started backends when a later backend fails to start', async () => {
    // agentsByBackend iterates in insertion order: 'openclaw' first (planner),
    // then 'hermes' (coder, tester). Make hermes.startRun throw so that
    // the already-succeeded openclaw must be rolled back via stopRun.
    const { runWorkflow, spies } = await loadRunWithMocks({
      hermesStart: async () => {
        throw new Error('hermes gateway failed');
      },
    });

    await expect(
      runWorkflow({ workflowId: 'mixed-wf', taskTitle: 'test' }),
    ).rejects.toThrow('backend start failed');

    // OpenClaw was started…
    expect(spies.openclawStartSpy).toHaveBeenCalledTimes(1);
    // …so it must be stopped on rollback.
    expect(spies.openclawStopSpy).toHaveBeenCalledTimes(1);
    // Hermes never fully started, no stop needed.
    expect(spies.hermesStopSpy).not.toHaveBeenCalled();
  });

  it('marks run as failed in the DB when startRun fails', async () => {
    const { runWorkflow, stmts } = await loadRunWithMocks({
      hermesStart: async () => {
        throw new Error('boom');
      },
    });

    await expect(
      runWorkflow({ workflowId: 'mixed-wf', taskTitle: 'test' }),
    ).rejects.toThrow();

    expect(stmts.updateRun.run).toHaveBeenCalled();
    const updateArgs = stmts.updateRun.run.mock.calls[0];
    expect(updateArgs[0]).toBeTruthy(); // timestamp
    expect(typeof updateArgs[1]).toBe('string'); // runId
  });
});
