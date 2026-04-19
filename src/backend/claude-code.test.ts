import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ClaudeCodeBackend, readClaudeCodeProjectDir } from './claude-code.js';
import type { WorkflowSpec } from '../installer/types.js';
import { resolveWorkflowDir } from '../installer/paths.js';

let tmp: string;
let originalStateDir: string | undefined;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-cc-backend-test-'));
  originalStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = path.join(tmp, 'openclaw-state');
});
after(async () => {
  if (originalStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = originalStateDir;
  await fs.rm(tmp, { recursive: true, force: true });
});

function makeWorkflow(): WorkflowSpec {
  return {
    id: 'demo',
    agents: [
      { id: 'planner',  role: 'analysis',     description: 'Plans work',    workspace: { baseDir: 'planner',  files: {} } },
      { id: 'coder',    role: 'coding',       description: 'Writes code',   workspace: { baseDir: 'coder',    files: {} } },
      { id: 'verifier', role: 'verification', description: 'Verifies work', workspace: { baseDir: 'verifier', files: {} } },
    ],
    steps: [],
  };
}

async function seedBootstrapFiles(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'bootstrap.md'), '# bootstrap\n', 'utf-8');
}

function applyBootstrapFiles(workflow: WorkflowSpec): WorkflowSpec {
  for (const agent of workflow.agents) {
    agent.workspace.files = { 'AGENTS.md': 'bootstrap.md' };
  }
  return workflow;
}

async function ensureWorkflowDir(workflowId: string): Promise<void> {
  await fs.mkdir(resolveWorkflowDir(workflowId), { recursive: true });
}

describe('ClaudeCodeBackend.install', () => {
  it('writes one subagent file per agent', async () => {
    const dir = path.join(tmp, 'install-1');
    await seedBootstrapFiles(dir);
    await ensureWorkflowDir('demo');
    const be = new ClaudeCodeBackend(dir);
    await be.install(applyBootstrapFiles(makeWorkflow()), dir);
    const entries = await fs.readdir(path.join(dir, '.claude/agents'));
    assert.deepEqual(entries.sort(), ['demo_coder.md', 'demo_planner.md', 'demo_verifier.md']);
  });

  it('installs antfarm-workflows skill', async () => {
    const dir = path.join(tmp, 'install-2');
    await seedBootstrapFiles(dir);
    await ensureWorkflowDir('demo');
    const be = new ClaudeCodeBackend(dir);
    await be.install(applyBootstrapFiles(makeWorkflow()), dir);
    await fs.access(path.join(dir, '.claude/skills/antfarm-workflows/SKILL.md'));
  });

  it('writes per-role disallowedTools into each subagent frontmatter — coding unrestricted, others restricted', async () => {
    const dir = path.join(tmp, 'install-3');
    await seedBootstrapFiles(dir);
    await ensureWorkflowDir('demo');
    const be = new ClaudeCodeBackend(dir);
    await be.install(applyBootstrapFiles(makeWorkflow()), dir);

    const coder = await fs.readFile(path.join(dir, '.claude/agents/demo_coder.md'), 'utf-8');
    assert.doesNotMatch(coder, /disallowedTools:/, 'coding role must retain write tools');

    const planner = await fs.readFile(path.join(dir, '.claude/agents/demo_planner.md'), 'utf-8');
    assert.match(planner, /disallowedTools: Write,Edit,MultiEdit,NotebookEdit/);

    const verifier = await fs.readFile(path.join(dir, '.claude/agents/demo_verifier.md'), 'utf-8');
    assert.match(verifier, /disallowedTools: Write,Edit,MultiEdit,NotebookEdit/);
  });

  it('does not write a global permissions.deny into settings.json (per-subagent frontmatter is the source of truth)', async () => {
    const dir = path.join(tmp, 'install-4');
    await seedBootstrapFiles(dir);
    await ensureWorkflowDir('demo');
    const be = new ClaudeCodeBackend(dir);
    await be.install(applyBootstrapFiles(makeWorkflow()), dir);

    // If the user's settings.json didn't exist, antfarm must not create one.
    await assert.rejects(
      fs.access(path.join(dir, '.claude/settings.json')),
      /ENOENT/,
    );
  });

  it('records projectDir marker under the workflow dir for later uninstall discovery', async () => {
    const dir = path.join(tmp, 'install-5');
    await seedBootstrapFiles(dir);
    await ensureWorkflowDir('demo');
    const be = new ClaudeCodeBackend(dir);
    await be.install(applyBootstrapFiles(makeWorkflow()), dir);
    const stored = await readClaudeCodeProjectDir('demo');
    assert.equal(stored, dir);
  });
});

describe('ClaudeCodeBackend.uninstall', () => {
  it('removes subagent files for the workflow and the skill', async () => {
    const dir = path.join(tmp, 'uninstall-1');
    await seedBootstrapFiles(dir);
    await ensureWorkflowDir('demo');
    const be = new ClaudeCodeBackend(dir);
    await be.install(applyBootstrapFiles(makeWorkflow()), dir);
    await be.uninstall('demo');
    const entries = await fs.readdir(path.join(dir, '.claude/agents')).catch(() => [] as string[]);
    assert.deepEqual(entries, []);
    await assert.rejects(
      fs.access(path.join(dir, '.claude/skills/antfarm-workflows/SKILL.md')),
      /ENOENT/,
    );
  });

  it('leaves a pre-existing user settings.json intact', async () => {
    const dir = path.join(tmp, 'uninstall-2');
    await seedBootstrapFiles(dir);
    await ensureWorkflowDir('demo');
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.claude/settings.json'),
      JSON.stringify({ permissions: { deny: ['UserExtra'] } }),
      'utf-8',
    );
    const be = new ClaudeCodeBackend(dir);
    await be.install(applyBootstrapFiles(makeWorkflow()), dir);
    await be.uninstall('demo');
    const settings = JSON.parse(await fs.readFile(path.join(dir, '.claude/settings.json'), 'utf-8'));
    assert.deepEqual(settings.permissions?.deny, ['UserExtra']);
  });
});

describe('ClaudeCodeBackend.startRun / stopRun', () => {
  it('start / stop are no-ops (scheduler drives ticks via SubprocessScheduler)', async () => {
    const be = new ClaudeCodeBackend(tmp);
    await be.startRun(makeWorkflow());
    await be.stopRun(makeWorkflow());
  });
});
