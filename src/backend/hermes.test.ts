import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HermesBackend, getProfileName } from './hermes.js';
import type { WorkflowAgent, WorkflowSpec } from '../installer/types.js';

type ExecResult = { stdout: string; stderr: string };
type ExecCall = { file: string; args: string[]; order: number };
type HermesCliState = {
  crons: Map<string, Map<string, string>>;
  installedSkills: Map<string, Set<string>>;
  nextJobId: number;
};
type ExecOverride = (call: ExecCall, state: HermesCliState) => Promise<ExecResult | undefined> | ExecResult | undefined;

function blankResult(): ExecResult {
  return { stdout: '', stderr: '' };
}

function formatCronList(jobs?: Map<string, string>): string {
  if (!jobs || jobs.size === 0) return '';
  return Array.from(jobs.entries())
    .map(([name, id]) => `${id} [active]\n    Name:      ${name}\n    Schedule:  every 5m`)
    .join('\n');
}

function formatSkillsList(skills?: Set<string>): string {
  if (!skills || skills.size === 0) return '';
  return Array.from(skills)
    .map((name) => `│ ${name} │ workspace │ local │ trusted │`)
    .join('\n');
}

function createHermesExecStub(home: string, override?: ExecOverride) {
  const state: HermesCliState = {
    crons: new Map(),
    installedSkills: new Map(),
    nextJobId: 1,
  };
  const calls: ExecCall[] = [];
  let order = 0;

  const exec = async (file: string, args: string[]): Promise<ExecResult> => {
    const call: ExecCall = { file, args: [...args], order: ++order };
    calls.push(call);

    const overridden = await override?.(call, state);
    if (overridden) return overridden;

    if (file !== 'hermes') return blankResult();

    if (args[0] === 'profile' && args[1] === 'create') {
      await fs.mkdir(path.join(home, 'profiles', args[2]), { recursive: true });
      return blankResult();
    }

    if (args[0] === 'profile' && args[1] === 'delete') {
      await fs.rm(path.join(home, 'profiles', args[2]), { recursive: true, force: true });
      return blankResult();
    }

    const profileName = args[0] === '--profile' ? args[1] : null;
    if (!profileName) return blankResult();

    if (args[2] === 'cron' && args[3] === 'list') {
      return { stdout: formatCronList(state.crons.get(profileName)), stderr: '' };
    }

    if (args[2] === 'cron' && args[3] === 'create') {
      const nameIndex = args.indexOf('--name');
      const cronName = nameIndex === -1 ? '' : args[nameIndex + 1];
      const jobs = state.crons.get(profileName) ?? new Map<string, string>();
      const jobId = state.nextJobId.toString(16).padStart(6, '0');
      state.nextJobId += 1;
      jobs.set(cronName, jobId);
      state.crons.set(profileName, jobs);
      return blankResult();
    }

    if (args[2] === 'cron' && args[3] === 'remove') {
      const jobId = args[4];
      const jobs = state.crons.get(profileName);
      if (jobs) {
        for (const [cronName, existingId] of jobs) {
          if (existingId === jobId) {
            jobs.delete(cronName);
          }
        }
      }
      return blankResult();
    }

    if (args[2] === 'skills' && args[3] === 'list') {
      return { stdout: formatSkillsList(state.installedSkills.get(profileName)), stderr: '' };
    }

    if (args[2] === 'skills' && args[3] === 'install') {
      const rawSkill = args[4];
      const slug = rawSkill.split('/').pop() ?? rawSkill;
      const installed = state.installedSkills.get(profileName) ?? new Set<string>();
      installed.add(slug);
      state.installedSkills.set(profileName, installed);
      return blankResult();
    }

    return blankResult();
  };

  return { exec, calls, state };
}

function findExecCall(calls: ExecCall[], predicate: (call: ExecCall) => boolean): ExecCall | undefined {
  return calls.find(predicate);
}

function filterExecCalls(calls: ExecCall[], predicate: (call: ExecCall) => boolean): ExecCall[] {
  return calls.filter(predicate);
}

function makeAgent(id = 'agent-1', overrides: Partial<WorkflowAgent> = {}): WorkflowAgent {
  const workspace = {
    baseDir: id,
    files: { 'CLAUDE.md': 'CLAUDE.md' },
    ...overrides.workspace,
  };
  const { workspace: _workspace, ...rest } = overrides;
  return {
    id,
    name: 'Test Agent',
    role: 'coding',
    model: 'claude-3-sonnet',
    workspace,
    ...rest,
  };
}

function makeWorkflow(agents: WorkflowAgent[]): WorkflowSpec {
  return {
    id: 'test-workflow',
    name: 'Test Workflow',
    version: 1,
    agents,
    steps: agents.map((agent, index) => ({
      id: `step-${index + 1}`,
      agent: agent.id,
      input: 'test',
      expects: 'result',
    })),
  };
}

async function writeBootstrap(sourceDir: string): Promise<void> {
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'CLAUDE.md'), '# bootstrap\n', 'utf-8');
}

async function writeMarker(hermesHome: string, profileName: string, workflowId: string): Promise<void> {
  const profileDir = path.join(hermesHome, 'profiles', profileName);
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    path.join(profileDir, '.antfarm'),
    JSON.stringify({ workflowId, version: 1, createdAt: '2024-01-01T00:00:00.000Z' }),
    'utf-8',
  );
}

describe('HermesBackend', () => {
  let tmp: string;
  let sourceDir: string;
  let hermesHome: string;
  let originalHermesHome: string | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-hermes-test-'));
    sourceDir = path.join(tmp, 'source');
    hermesHome = path.join(tmp, 'hermes-home');
    await writeBootstrap(sourceDir);
    originalHermesHome = process.env.HERMES_HOME;
    process.env.HERMES_HOME = hermesHome;
  });

  afterEach(async () => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('builds profile names with an underscore separator', () => {
    assert.equal(getProfileName('my-workflow', 'agent-1'), 'my-workflow_agent-1');
    assert.equal(getProfileName('foo', 'bar-baz'), 'foo_bar-baz');
    assert.notEqual(getProfileName('foo', 'bar-baz'), getProfileName('foo-bar', 'baz'));
  });

  it('installs a profile, marker, workspace, cron, and shared skill', async () => {
    const stub = createHermesExecStub(hermesHome);
    const backend = new HermesBackend(stub.exec);
    const workflow = makeWorkflow([makeAgent()]);

    await backend.install(workflow, sourceDir);

    const profileName = 'test-workflow_agent-1';
    const workspaceFile = path.join(hermesHome, 'profiles', profileName, 'workspace', 'CLAUDE.md');
    const markerPath = path.join(hermesHome, 'profiles', profileName, '.antfarm');
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf-8')) as { workflowId: string; version: number };

    assert.equal(marker.workflowId, 'test-workflow');
    assert.equal(marker.version, 1);
    assert.equal(await fs.readFile(workspaceFile, 'utf-8'), '# bootstrap\n');
    await fs.access(path.join(hermesHome, 'skills', 'antfarm-workflows', 'SKILL.md'));

    assert.ok(findExecCall(stub.calls, (call) =>
      call.args[0] === 'profile' &&
      call.args[1] === 'create' &&
      call.args[2] === profileName,
    ));
    assert.ok(findExecCall(stub.calls, (call) =>
      call.args[0] === '--profile' &&
      call.args[1] === profileName &&
      call.args[2] === 'config' &&
      call.args[3] === 'set' &&
      call.args[4] === 'model.model' &&
      call.args[5] === 'claude-3-sonnet',
    ));
    assert.ok(findExecCall(stub.calls, (call) =>
      call.args[0] === '--profile' &&
      call.args[1] === profileName &&
      call.args[2] === 'cron' &&
      call.args[3] === 'create' &&
      call.args.includes('antfarm/test-workflow/agent-1'),
    ));
  });

  it('skips profile creation when the existing profile already belongs to the workflow', async () => {
    const profileName = 'test-workflow_agent-1';
    await writeMarker(hermesHome, profileName, 'test-workflow');
    const stub = createHermesExecStub(hermesHome);
    const backend = new HermesBackend(stub.exec);

    await backend.install(makeWorkflow([makeAgent()]), sourceDir);

    assert.equal(filterExecCalls(stub.calls, (call) =>
      call.args[0] === 'profile' && call.args[1] === 'create',
    ).length, 0);
    assert.ok(findExecCall(stub.calls, (call) =>
      call.args[0] === '--profile' &&
      call.args[1] === profileName &&
      call.args[2] === 'config' &&
      call.args[3] === 'set',
    ));
  });

  it('rejects an existing profile owned by another workflow', async () => {
    await writeMarker(hermesHome, 'test-workflow_agent-1', 'different-workflow');
    const stub = createHermesExecStub(hermesHome);
    const backend = new HermesBackend(stub.exec);

    await assert.rejects(
      backend.install(makeWorkflow([makeAgent()]), sourceDir),
      /belongs to a different workflow/,
    );
  });

  it('rejects an existing profile without an ownership marker', async () => {
    await fs.mkdir(path.join(hermesHome, 'profiles', 'test-workflow_agent-1'), { recursive: true });
    const stub = createHermesExecStub(hermesHome);
    const backend = new HermesBackend(stub.exec);

    await assert.rejects(
      backend.install(makeWorkflow([makeAgent()]), sourceDir),
      /belongs to a different workflow/,
    );
  });

  it('installs only missing workspace skills', async () => {
    const stub = createHermesExecStub(hermesHome);
    stub.state.installedSkills.set('test-workflow_agent-1', new Set(['agent-browser']));
    const backend = new HermesBackend(stub.exec);
    const workflow = makeWorkflow([
      makeAgent('agent-1', {
        workspace: {
          baseDir: 'agent-1',
          files: { 'CLAUDE.md': 'CLAUDE.md' },
          skills: ['agent-browser', 'web-search'],
        },
      }),
    ]);

    await backend.install(workflow, sourceDir);

    const installCalls = filterExecCalls(stub.calls, (call) =>
      call.args[0] === '--profile' &&
      call.args[1] === 'test-workflow_agent-1' &&
      call.args[2] === 'skills' &&
      call.args[3] === 'install',
    );
    assert.deepEqual(installCalls.map((call) => call.args[4]), ['web-search']);
  });

  it('preserves timeoutSeconds=0 instead of falling back to the default timeout', async () => {
    const stub = createHermesExecStub(hermesHome);
    const backend = new HermesBackend(stub.exec);
    const workflow = makeWorkflow([makeAgent('agent-1', { timeoutSeconds: 0 })]);

    await backend.install(workflow, sourceDir);

    assert.ok(findExecCall(stub.calls, (call) =>
      call.args[0] === '--profile' &&
      call.args[1] === 'test-workflow_agent-1' &&
      call.args[2] === 'config' &&
      call.args[3] === 'set' &&
      call.args[4] === 'timeout.seconds' &&
      call.args[5] === '0',
    ));
  });

  it('uses the default model string when the agent model is unset', async () => {
    const stub = createHermesExecStub(hermesHome);
    const backend = new HermesBackend(stub.exec);
    const workflow = makeWorkflow([makeAgent('agent-1', { model: undefined })]);

    await backend.install(workflow, sourceDir);

    assert.ok(findExecCall(stub.calls, (call) =>
      call.args[0] === '--profile' &&
      call.args[1] === 'test-workflow_agent-1' &&
      call.args[2] === 'config' &&
      call.args[3] === 'set' &&
      call.args[4] === 'model.model' &&
      call.args[5] === 'default',
    ));
  });

  it('rolls back previously created profiles when a later install step fails', async () => {
    const stub = createHermesExecStub(hermesHome, (call) => {
      if (
        call.args[0] === '--profile' &&
        call.args[1] === 'test-workflow_agent-2' &&
        call.args[2] === 'cron' &&
        call.args[3] === 'create'
      ) {
        throw new Error('Cron setup failed');
      }
      return undefined;
    });
    const backend = new HermesBackend(stub.exec);
    const workflow = makeWorkflow([
      makeAgent('agent-1'),
      makeAgent('agent-2'),
    ]);

    await assert.rejects(backend.install(workflow, sourceDir), /Cron setup failed/);

    assert.equal(filterExecCalls(stub.calls, (call) =>
      call.args[0] === 'profile' &&
      call.args[1] === 'delete',
    ).length, 2);
    assert.ok(findExecCall(stub.calls, (call) =>
      call.args[0] === '--profile' &&
      call.args[1] === 'test-workflow_agent-1' &&
      call.args[2] === 'cron' &&
      call.args[3] === 'remove',
    ));
    await assert.rejects(
      fs.access(path.join(hermesHome, 'profiles', 'test-workflow_agent-1')),
      /ENOENT/,
    );
    await assert.rejects(
      fs.access(path.join(hermesHome, 'profiles', 'test-workflow_agent-2')),
      /ENOENT/,
    );
  });

  it('uninstalls only profiles that belong to the requested workflow', async () => {
    await writeMarker(hermesHome, 'test-workflow_agent-1', 'test-workflow');
    await writeMarker(hermesHome, 'test-workflow-2_agent-1', 'test-workflow-2');
    await writeMarker(hermesHome, 'other_agent-1', 'other');
    const stub = createHermesExecStub(hermesHome);
    const backend = new HermesBackend(stub.exec);

    await backend.uninstall('test-workflow');

    const deleteCalls = filterExecCalls(stub.calls, (call) =>
      call.args[0] === 'profile' &&
      call.args[1] === 'delete',
    );
    assert.deepEqual(deleteCalls.map((call) => call.args[2]), ['test-workflow_agent-1']);
    await assert.rejects(
      fs.access(path.join(hermesHome, 'profiles', 'test-workflow_agent-1')),
      /ENOENT/,
    );
    await fs.access(path.join(hermesHome, 'profiles', 'test-workflow-2_agent-1'));
    await fs.access(path.join(hermesHome, 'profiles', 'other_agent-1'));
  });

  it('skips unowned profiles during uninstall even when the prefix matches', async () => {
    await writeMarker(hermesHome, 'test-workflow_agent-1', 'test-workflow');
    await writeMarker(hermesHome, 'test-workflow_agent-2', 'other-workflow');
    const stub = createHermesExecStub(hermesHome);
    const backend = new HermesBackend(stub.exec);

    await backend.uninstall('test-workflow');

    const deleteCalls = filterExecCalls(stub.calls, (call) =>
      call.args[0] === 'profile' &&
      call.args[1] === 'delete',
    );
    assert.deepEqual(deleteCalls.map((call) => call.args[2]), ['test-workflow_agent-1']);
    await fs.access(path.join(hermesHome, 'profiles', 'test-workflow_agent-2'));
  });

  it('does not fail uninstall when the profiles directory does not exist', async () => {
    const backend = new HermesBackend(createHermesExecStub(hermesHome).exec);
    await backend.uninstall('test-workflow');
  });

  it('starts each profile gateway and rolls back earlier starts when a later one fails', async () => {
    const stub = createHermesExecStub(hermesHome, (call) => {
      if (
        call.args[0] === '--profile' &&
        call.args[1] === 'test-workflow_agent-3' &&
        call.args[2] === 'gateway' &&
        call.args[3] === 'start'
      ) {
        throw new Error('Port already in use');
      }
      return undefined;
    });
    const backend = new HermesBackend(stub.exec);
    const workflow = makeWorkflow([
      makeAgent('agent-1'),
      makeAgent('agent-2'),
      makeAgent('agent-3'),
    ]);

    await assert.rejects(backend.startRun(workflow), /Port already in use/);

    const stopCalls = filterExecCalls(stub.calls, (call) =>
      call.args[0] === '--profile' &&
      (call.args[1] === 'test-workflow_agent-1' || call.args[1] === 'test-workflow_agent-2') &&
      call.args[2] === 'gateway' &&
      call.args[3] === 'stop',
    );
    assert.equal(stopCalls.length, 2);
  });

  it('passes profile names as literal exec arguments', async () => {
    const stub = createHermesExecStub(hermesHome);
    const backend = new HermesBackend(stub.exec);
    const workflow: WorkflowSpec = {
      id: 'test; rm -rf /; #',
      agents: [makeAgent('agent-1')],
      steps: [{ id: 'step-1', agent: 'agent-1', input: 'x', expects: 'y' }],
    };

    await backend.startRun(workflow);

    const startCall = findExecCall(stub.calls, (call) =>
      call.args[0] === '--profile' &&
      call.args[2] === 'gateway' &&
      call.args[3] === 'start',
    );
    assert.ok(startCall);
    assert.equal(startCall?.args[1], 'test; rm -rf /; #_agent-1');
  });

  it('stops gateways without throwing when a profile is not running and logs a warning', async () => {
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      const stub = createHermesExecStub(hermesHome, (call) => {
        if (
          call.args[0] === '--profile' &&
          call.args[2] === 'gateway' &&
          call.args[3] === 'stop'
        ) {
          throw new Error('gateway not running');
        }
        return undefined;
      });
      const backend = new HermesBackend(stub.exec);

      await backend.stopRun(makeWorkflow([makeAgent()]));

      assert.equal(warnings.length, 1);
      assert.match(String(warnings[0][0]), /Failed to stop gateway/);
    } finally {
      console.warn = originalWarn;
    }
  });
});
