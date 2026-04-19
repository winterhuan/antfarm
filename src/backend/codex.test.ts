import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CodexBackend } from './codex.js';
import { ANTFARM_BLOCK_BEGIN } from './codex-config.js';
import type { WorkflowSpec } from '../installer/types.js';

let tmp: string;
let originalCodexHome: string | undefined;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-codex-be-'));
  originalCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = tmp;
});
after(async () => {
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  await fs.rm(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  const entries = await fs.readdir(tmp).catch(() => [] as string[]);
  for (const e of entries) {
    await fs.rm(path.join(tmp, e), { recursive: true, force: true });
  }
});

function makeWorkflow(id = 'demo'): WorkflowSpec {
  return {
    id,
    agents: [
      { id: 'planner',  role: 'analysis',     description: 'Plans work',    workspace: { baseDir: 'planner',  files: {} } },
      { id: 'coder',    role: 'coding',       description: 'Writes code',   workspace: { baseDir: 'coder',    files: {} } },
      { id: 'verifier', role: 'verification', description: 'Verifies work', workspace: { baseDir: 'verifier', files: {} } },
    ],
    steps: [],
  };
}

describe('CodexBackend.install', () => {
  it('writes one role overlay TOML per agent', async () => {
    const be = new CodexBackend();
    await be.install(makeWorkflow(), tmp);
    const entries = (await fs.readdir(path.join(tmp, 'agents'))).sort();
    assert.deepEqual(entries, [
      'antfarm-demo-coder.toml',
      'antfarm-demo-planner.toml',
      'antfarm-demo-verifier.toml',
    ]);
  });

  it('each overlay has correct sandbox_mode per role', async () => {
    const be = new CodexBackend();
    await be.install(makeWorkflow(), tmp);
    const verifier = await fs.readFile(path.join(tmp, 'agents/antfarm-demo-verifier.toml'), 'utf-8');
    assert.match(verifier, /sandbox_mode = "read-only"/);
    const coder = await fs.readFile(path.join(tmp, 'agents/antfarm-demo-coder.toml'), 'utf-8');
    assert.match(coder, /sandbox_mode = "workspace-write"/);
    const planner = await fs.readFile(path.join(tmp, 'agents/antfarm-demo-planner.toml'), 'utf-8');
    assert.match(planner, /sandbox_mode = "read-only"/);
  });

  it('config.toml contains profiles + agent_roles entries inside antfarm block', async () => {
    const be = new CodexBackend();
    await be.install(makeWorkflow(), tmp);
    const cfg = await fs.readFile(path.join(tmp, 'config.toml'), 'utf-8');
    assert.match(cfg, new RegExp(ANTFARM_BLOCK_BEGIN));
    assert.match(cfg, /\[profiles\."antfarm-demo-planner"\]/);
    assert.match(cfg, /\[profiles\."antfarm-demo-coder"\]/);
    assert.match(cfg, /\[profiles\."antfarm-demo-verifier"\]/);
    assert.match(cfg, /\[agent_roles\."antfarm-demo-planner"\]/);
    assert.match(cfg, /\[agent_roles\."antfarm-demo-coder"\]/);
    assert.match(cfg, /\[agent_roles\."antfarm-demo-verifier"\]/);
  });

  it('installs antfarm-workflows skill globally', async () => {
    const be = new CodexBackend();
    await be.install(makeWorkflow(), tmp);
    await fs.access(path.join(tmp, 'skills/antfarm-workflows/SKILL.md'));
  });

  it('preserves user content in config.toml', async () => {
    await fs.mkdir(tmp, { recursive: true });
    await fs.writeFile(path.join(tmp, 'config.toml'), '[user]\nkey = "value"\n', 'utf-8');
    const be = new CodexBackend();
    await be.install(makeWorkflow(), tmp);
    const cfg = await fs.readFile(path.join(tmp, 'config.toml'), 'utf-8');
    assert.match(cfg, /\[user\]/);
    assert.match(cfg, /key = "value"/);
    assert.match(cfg, new RegExp(ANTFARM_BLOCK_BEGIN));
  });

  it('is idempotent: re-install replaces the block without duplicating', async () => {
    const be = new CodexBackend();
    await be.install(makeWorkflow(), tmp);
    await be.install(makeWorkflow(), tmp);
    const cfg = await fs.readFile(path.join(tmp, 'config.toml'), 'utf-8');
    const blocks = (cfg.match(new RegExp(ANTFARM_BLOCK_BEGIN, 'g')) ?? []).length;
    assert.equal(blocks, 1);
  });
});

describe('CodexBackend.uninstall', () => {
  it('removes overlay TOMLs and config.toml entries for the specified workflow only', async () => {
    const be = new CodexBackend();
    await be.install(makeWorkflow('alpha'), tmp);
    await be.install(makeWorkflow('beta'), tmp);

    await be.uninstall('alpha');

    const remainingOverlays = (await fs.readdir(path.join(tmp, 'agents'))).sort();
    assert.ok(remainingOverlays.every((n) => !n.startsWith('antfarm-alpha-')));
    assert.ok(remainingOverlays.some((n) => n.startsWith('antfarm-beta-')));

    const cfg = await fs.readFile(path.join(tmp, 'config.toml'), 'utf-8');
    assert.doesNotMatch(cfg, /antfarm-alpha-/);
    assert.match(cfg, /antfarm-beta-/);
  });

  it('removes the whole antfarm block + skill when last workflow is uninstalled', async () => {
    const be = new CodexBackend();
    await be.install(makeWorkflow('only'), tmp);
    await be.uninstall('only');
    const cfg = await fs.readFile(path.join(tmp, 'config.toml'), 'utf-8').catch(() => '');
    assert.doesNotMatch(cfg, new RegExp(ANTFARM_BLOCK_BEGIN));
    await assert.rejects(
      fs.access(path.join(tmp, 'skills/antfarm-workflows/SKILL.md')),
      /ENOENT/,
    );
  });
});

describe('CodexBackend.startRun / stopRun', () => {
  it('start / stop are no-ops in this phase', async () => {
    const be = new CodexBackend();
    await be.startRun(makeWorkflow());
    await be.stopRun(makeWorkflow());
  });
});
