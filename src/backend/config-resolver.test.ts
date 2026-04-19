import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveBackendConfig, validateBackendType } from './config-resolver.js';
import type { WorkflowAgent, WorkflowSpec } from '../installer/types.js';

async function withTempHome(fn: (home: string) => Promise<void>): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-config-test-'));
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

function makeAgent(id = 'planner', backend?: WorkflowAgent['backend']): WorkflowAgent {
  return {
    id,
    workspace: { baseDir: id, files: {} },
    ...(backend ? { backend } : {}),
  };
}

function makeWorkflow(agent: WorkflowAgent, defaultBackend?: WorkflowSpec['defaultBackend']): WorkflowSpec {
  return {
    id: 'demo-workflow',
    agents: [agent],
    steps: [],
    ...(defaultBackend ? { defaultBackend } : {}),
  };
}

describe('resolveBackendConfig', () => {
  it('prefers the CLI backend over agent, workflow, and global config', async () => {
    await withTempHome(async (home) => {
      await writeConfig(home, 'defaultBackend: codex\n');
      const agent = makeAgent('planner', 'hermes');
      const workflow = makeWorkflow(agent, 'claude-code');

      const resolved = await resolveBackendConfig(agent, workflow, 'openclaw');

      assert.deepEqual(resolved, { type: 'openclaw', source: 'cli' });
    });
  });

  it('uses the agent backend when no CLI override is provided', async () => {
    await withTempHome(async () => {
      const agent = makeAgent('planner', 'hermes');

      const resolved = await resolveBackendConfig(agent, makeWorkflow(agent, 'codex'));

      assert.deepEqual(resolved, { type: 'hermes', source: 'agent' });
    });
  });

  it('uses the workflow default when the agent has no backend', async () => {
    await withTempHome(async () => {
      const agent = makeAgent();

      const resolved = await resolveBackendConfig(agent, makeWorkflow(agent, 'claude-code'));

      assert.deepEqual(resolved, { type: 'claude-code', source: 'workflow' });
    });
  });

  it('uses the global config when agent and workflow are unset', async () => {
    await withTempHome(async (home) => {
      await writeConfig(home, 'defaultBackend: codex\n');
      const agent = makeAgent();

      const resolved = await resolveBackendConfig(agent, makeWorkflow(agent));

      assert.deepEqual(resolved, { type: 'codex', source: 'global' });
    });
  });

  it('falls back to the built-in default when the config file is empty', async () => {
    await withTempHome(async (home) => {
      await writeConfig(home, 'null\n');
      const agent = makeAgent();

      const resolved = await resolveBackendConfig(agent, makeWorkflow(agent));

      assert.deepEqual(resolved, { type: 'openclaw', source: 'default' });
    });
  });

  it('keeps workflow default higher priority than global config', async () => {
    await withTempHome(async (home) => {
      await writeConfig(home, 'defaultBackend: codex\n');
      const agent = makeAgent();

      const resolved = await resolveBackendConfig(agent, makeWorkflow(agent, 'hermes'));

      assert.deepEqual(resolved, { type: 'hermes', source: 'workflow' });
    });
  });
});

describe('validateBackendType', () => {
  it('accepts openclaw', () => {
    assert.equal(validateBackendType('openclaw'), 'openclaw');
  });

  it('accepts hermes', () => {
    assert.equal(validateBackendType('hermes'), 'hermes');
  });

  it('accepts claude-code', () => {
    assert.equal(validateBackendType('claude-code'), 'claude-code');
  });

  it('accepts codex', () => {
    assert.equal(validateBackendType('codex'), 'codex');
  });

  it('rejects unknown backends', () => {
    assert.throws(() => validateBackendType('nope'), /Unknown backend type/);
  });
});
