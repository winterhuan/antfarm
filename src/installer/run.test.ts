import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import type { Backend, BackendType } from '../backend/interface.js';
import type { WorkflowSpec } from './types.js';

type RunWorkflowFn = typeof import('./run.js').runWorkflow;
type GetDbFn = typeof import('../db.js').getDb;

type BackendSpy = {
  backend: Backend;
  startCalls: string[][];
  stopCalls: string[][];
};

let tmp: string;
let homeDir: string;
let stateDir: string;
let originalHome: string | undefined;
let originalStateDir: string | undefined;
let runWorkflow: RunWorkflowFn;
let getDb: GetDbFn;

function makeAgent(id: string, backend?: BackendType): WorkflowSpec['agents'][number] {
  return {
    id,
    name: id,
    role: 'coding',
    workspace: { baseDir: id, files: { 'AGENTS.md': 'bootstrap.md' } },
    ...(backend ? { backend } : {}),
  };
}

function makeWorkflow(): WorkflowSpec {
  return {
    id: 'mixed-wf',
    name: 'Mixed Workflow',
    version: 1,
    agents: [
      makeAgent('planner', 'openclaw'),
      makeAgent('coder', 'hermes'),
      makeAgent('tester', 'hermes'),
    ],
    steps: [
      { id: 'plan', agent: 'planner', input: 'x', expects: 'y' },
      { id: 'code', agent: 'coder', input: 'x', expects: 'y' },
      { id: 'verify', agent: 'tester', input: 'x', expects: 'y' },
    ],
  };
}

function createSpyBackend(opts: {
  onStart?: (agentIds: string[]) => Promise<void> | void;
  onStop?: (agentIds: string[]) => Promise<void> | void;
} = {}): BackendSpy {
  const startCalls: string[][] = [];
  const stopCalls: string[][] = [];
  return {
    backend: {
      install: async () => {},
      uninstall: async () => {},
      startRun: async (workflow) => {
        const agentIds = workflow.agents.map((agent) => agent.id);
        startCalls.push(agentIds);
        await opts.onStart?.(agentIds);
      },
      stopRun: async (workflow) => {
        const agentIds = workflow.agents.map((agent) => agent.id);
        stopCalls.push(agentIds);
        await opts.onStop?.(agentIds);
      },
      // New interface methods
      configureAgent: async () => {},
      removeAgent: async () => {},
      validate: async () => ({ valid: true, errors: [], warnings: [] }),
      capabilities: {
        supportsPerToolDeny: true,
        supportsSandbox: false,
        schedulerDriven: false,
        supportsCronManagement: true,
      },
      permissionAdapter: {
        applyRoleConstraints: async () => {},
        removeRoleConstraints: async () => {},
      },
    },
    startCalls,
    stopCalls,
  };
}

async function writeWorkflow(workflow: WorkflowSpec): Promise<void> {
  const workflowDir = path.join(stateDir, 'antfarm', 'workflows', workflow.id);
  await fs.mkdir(workflowDir, { recursive: true });
  await fs.writeFile(path.join(workflowDir, 'workflow.yml'), YAML.stringify(workflow), 'utf-8');
}

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-run-test-'));
  homeDir = path.join(tmp, 'home');
  stateDir = path.join(tmp, 'state');
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });

  originalHome = process.env.HOME;
  originalStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.HOME = homeDir;
  process.env.OPENCLAW_STATE_DIR = stateDir;

  ({ runWorkflow } = await import('./run.js'));
  ({ getDb } = await import('../db.js'));
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = originalStateDir;
  await fs.rm(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(path.join(stateDir, 'antfarm', 'workflows'), { recursive: true, force: true });
  const db = getDb();
  db.prepare('DELETE FROM steps').run();
  db.prepare('DELETE FROM runs').run();
});

describe('runWorkflow mixed-backend support', () => {
  it('starts each backend once with only the agents assigned to it', async () => {
    const workflow = makeWorkflow();
    await writeWorkflow(workflow);

    const openclaw = createSpyBackend();
    const hermes = createSpyBackend();
    const backendMap = new Map<BackendType, Backend>([
      ['openclaw', openclaw.backend],
      ['hermes', hermes.backend],
    ]);

    const result = await runWorkflow(
      { workflowId: workflow.id, taskTitle: 'test mixed backends' },
      { createBackend: (type) => backendMap.get(type) ?? createSpyBackend().backend },
    );

    assert.equal(result.workflowId, 'mixed-wf');
    assert.equal(result.status, 'running');
    assert.deepEqual(openclaw.startCalls, [['planner']]);
    assert.deepEqual(hermes.startCalls, [['coder', 'tester']]);
  });

  it('rolls back already started backends when a later backend fails to start', async () => {
    const workflow = makeWorkflow();
    await writeWorkflow(workflow);

    const openclaw = createSpyBackend();
    const hermes = createSpyBackend({
      onStart: async () => {
        throw new Error('hermes gateway failed');
      },
    });
    const backendMap = new Map<BackendType, Backend>([
      ['openclaw', openclaw.backend],
      ['hermes', hermes.backend],
    ]);

    await assert.rejects(
      runWorkflow(
        { workflowId: workflow.id, taskTitle: 'test rollback' },
        { createBackend: (type) => backendMap.get(type) ?? createSpyBackend().backend },
      ),
      /backend start failed/,
    );

    assert.deepEqual(openclaw.startCalls, [['planner']]);
    assert.deepEqual(openclaw.stopCalls, [['planner']]);
    assert.equal(hermes.stopCalls.length, 0);
  });

  it('marks the run as failed in the database when backend startup fails', async () => {
    const workflow = makeWorkflow();
    await writeWorkflow(workflow);

    const openclaw = createSpyBackend();
    const hermes = createSpyBackend({
      onStart: async () => {
        throw new Error('boom');
      },
    });
    const backendMap = new Map<BackendType, Backend>([
      ['openclaw', openclaw.backend],
      ['hermes', hermes.backend],
    ]);

    await assert.rejects(
      runWorkflow(
        { workflowId: workflow.id, taskTitle: 'test failed run' },
        { createBackend: (type) => backendMap.get(type) ?? createSpyBackend().backend },
      ),
      /boom/,
    );

    const db = getDb();
    const run = db.prepare('SELECT status FROM runs ORDER BY created_at DESC LIMIT 1').get() as { status: string } | undefined;
    assert.equal(run?.status, 'failed');
  });
});
