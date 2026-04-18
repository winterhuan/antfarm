import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ClaudeCodeBackend } from './claude-code.js';
import type { WorkflowSpec } from '../installer/types.js';

let tmp: string;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-cc-backend-test-'));
});
after(async () => {
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

describe('ClaudeCodeBackend.install', () => {
  it('writes one subagent file per agent', async () => {
    const dir = path.join(tmp, 'install-1');
    const be = new ClaudeCodeBackend(dir);
    await be.install(makeWorkflow(), dir);
    const entries = await fs.readdir(path.join(dir, '.claude/agents'));
    assert.deepEqual(entries.sort(), ['demo_coder.md', 'demo_planner.md', 'demo_verifier.md']);
  });

  it('installs antfarm-workflows skill', async () => {
    const dir = path.join(tmp, 'install-2');
    const be = new ClaudeCodeBackend(dir);
    await be.install(makeWorkflow(), dir);
    await fs.access(path.join(dir, '.claude/skills/antfarm-workflows/SKILL.md'));
  });

  it('merges role-based permissions.deny into settings.json', async () => {
    const dir = path.join(tmp, 'install-3');
    const be = new ClaudeCodeBackend(dir);
    await be.install(makeWorkflow(), dir);
    const settings = JSON.parse(await fs.readFile(path.join(dir, '.claude/settings.json'), 'utf-8'));
    assert.ok(settings.permissions.deny.includes('Write'));
    assert.ok(settings.permissions.deny.includes('Edit'));
    assert.ok(settings.permissions.deny.includes('MultiEdit'));
    assert.ok(settings.permissions.deny.includes('NotebookEdit'));
  });
});

describe('ClaudeCodeBackend.uninstall', () => {
  it('removes subagent files for the workflow and the skill', async () => {
    const dir = path.join(tmp, 'uninstall-1');
    const be = new ClaudeCodeBackend(dir);
    await be.install(makeWorkflow(), dir);
    await be.uninstall('demo');
    const entries = await fs.readdir(path.join(dir, '.claude/agents')).catch(() => [] as string[]);
    assert.deepEqual(entries, []);
    await assert.rejects(
      fs.access(path.join(dir, '.claude/skills/antfarm-workflows/SKILL.md')),
      /ENOENT/,
    );
  });

  it('removes antfarm-managed deny entries but leaves user entries intact', async () => {
    const dir = path.join(tmp, 'uninstall-2');
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.claude/settings.json'),
      JSON.stringify({ permissions: { deny: ['UserExtra'] } }),
      'utf-8',
    );
    const be = new ClaudeCodeBackend(dir);
    await be.install(makeWorkflow(), dir);
    await be.uninstall('demo');
    const settings = JSON.parse(await fs.readFile(path.join(dir, '.claude/settings.json'), 'utf-8'));
    assert.deepEqual(settings.permissions?.deny, ['UserExtra']);
  });
});

describe('ClaudeCodeBackend.startRun / stopRun', () => {
  it('start / stop are no-ops in this phase (scheduler deferred)', async () => {
    const be = new ClaudeCodeBackend(tmp);
    await be.startRun(makeWorkflow());
    await be.stopRun(makeWorkflow());
  });
});
