import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { groupAgentsByBackend } from './group-agents.js';
import type { WorkflowAgent, WorkflowSpec } from '../installer/types.js';

async function withTempHome(fn: (home: string) => Promise<void>): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-group-test-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tmp;
  try {
    await fn(tmp);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function writeConfig(home: string, raw: string): Promise<void> {
  const configDir = path.join(home, '.config', 'antfarm');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'config.yaml'), raw, 'utf-8');
}

function makeAgent(id: string, backend?: WorkflowAgent['backend']): WorkflowAgent {
  return {
    id,
    workspace: { baseDir: id, files: {} },
    ...(backend ? { backend } : {}),
  };
}

function makeWorkflow(agents: WorkflowAgent[], defaultBackend?: WorkflowSpec['defaultBackend']): WorkflowSpec {
  return {
    id: 'mixed-wf',
    agents,
    steps: agents.map((agent) => ({
      id: `step-${agent.id}`,
      agent: agent.id,
      input: 'x',
      expects: 'y',
    })),
    ...(defaultBackend ? { defaultBackend } : {}),
  };
}

describe('groupAgentsByBackend', () => {
  it('groups agents by their explicit backend field', async () => {
    const workflow = makeWorkflow([
      makeAgent('planner', 'openclaw'),
      makeAgent('coder', 'hermes'),
      makeAgent('reviewer', 'codex'),
      makeAgent('verifier', 'hermes'),
    ]);

    const groups = await groupAgentsByBackend(workflow);

    assert.deepEqual(groups.get('openclaw')?.map((agent) => agent.id), ['planner']);
    assert.deepEqual(groups.get('hermes')?.map((agent) => agent.id), ['coder', 'verifier']);
    assert.deepEqual(groups.get('codex')?.map((agent) => agent.id), ['reviewer']);
  });

  it('falls back to the workflow default when an agent has no backend', async () => {
    const workflow = makeWorkflow([
      makeAgent('planner'),
      makeAgent('coder', 'hermes'),
    ], 'claude-code');

    const groups = await groupAgentsByBackend(workflow);

    assert.deepEqual(groups.get('claude-code')?.map((agent) => agent.id), ['planner']);
    assert.deepEqual(groups.get('hermes')?.map((agent) => agent.id), ['coder']);
  });

  it('respects the global config default when workflow and agent are unset', async () => {
    await withTempHome(async (home) => {
      await writeConfig(home, 'defaultBackend: codex\n');
      const workflow = makeWorkflow([makeAgent('planner')]);

      const groups = await groupAgentsByBackend(workflow);

      assert.deepEqual(groups.get('codex')?.map((agent) => agent.id), ['planner']);
      assert.equal(groups.has('openclaw'), false);
    });
  });

  it('lets the CLI backend override every other source', async () => {
    const workflow = makeWorkflow([
      makeAgent('planner', 'openclaw'),
      makeAgent('coder', 'hermes'),
      makeAgent('reviewer', 'codex'),
    ], 'claude-code');

    const groups = await groupAgentsByBackend(workflow, 'hermes');

    assert.equal(groups.size, 1);
    assert.deepEqual(groups.get('hermes')?.map((agent) => agent.id), ['planner', 'coder', 'reviewer']);
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

    assert.deepEqual(groups.get('hermes')?.map((agent) => agent.id), ['a', 'c', 'e']);
    assert.deepEqual(groups.get('openclaw')?.map((agent) => agent.id), ['b', 'd']);
  });

  it('returns an empty map for an empty workflow', async () => {
    const workflow = makeWorkflow([]);

    const groups = await groupAgentsByBackend(workflow);

    assert.equal(groups.size, 0);
  });
});
