import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  writeRoleOverlayFile,
  removeRoleOverlayFiles,
  upsertAntfarmConfigBlock,
  removeWorkflowEntriesFromConfigBlock,
  ANTFARM_BLOCK_BEGIN,
  ANTFARM_BLOCK_END,
} from './codex-config.js';

let tmp: string;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-codex-cfg-'));
});
after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('writeRoleOverlayFile', () => {
  it('writes an overlay TOML with expected fields', async () => {
    const filePath = path.join(tmp, 'overlay-1.toml');
    await writeRoleOverlayFile({
      filePath,
      model: 'gpt-5.3-codex',
      sandboxMode: 'read-only',
      modelReasoningEffort: 'high',
      developerInstructions: 'You are the test agent.\nLine two.',
    });
    const text = await fs.readFile(filePath, 'utf-8');
    assert.match(text, /^model = "gpt-5\.3-codex"$/m);
    assert.match(text, /^sandbox_mode = "read-only"$/m);
    assert.match(text, /^model_reasoning_effort = "high"$/m);
    assert.match(text, /developer_instructions = """/);
    assert.match(text, /You are the test agent\./);
    assert.match(text, /Line two\./);
  });

  it('escapes triple-quote sequence in developer_instructions', async () => {
    const filePath = path.join(tmp, 'overlay-escape.toml');
    await writeRoleOverlayFile({
      filePath,
      model: 'm',
      sandboxMode: 'read-only',
      modelReasoningEffort: 'low',
      developerInstructions: 'injected """ quote attempt',
    });
    const text = await fs.readFile(filePath, 'utf-8');
    // Extract just the body between opening `"""` and closing `"""` markers
    const bodyMatch = text.match(/developer_instructions = """\n([\s\S]*?)\n"""/);
    assert.ok(bodyMatch, 'expected triple-quoted block');
    assert.doesNotMatch(bodyMatch[1], /"""/);
  });
});

describe('removeRoleOverlayFiles', () => {
  it('deletes matching antfarm-<workflowId>-*.toml files, leaves others alone', async () => {
    const d = path.join(tmp, 'overlays-dir');
    await fs.mkdir(d, { recursive: true });
    await fs.writeFile(path.join(d, 'antfarm-demo-coder.toml'), 'x', 'utf-8');
    await fs.writeFile(path.join(d, 'antfarm-demo-verifier.toml'), 'x', 'utf-8');
    await fs.writeFile(path.join(d, 'antfarm-other-a.toml'), 'x', 'utf-8');
    await fs.writeFile(path.join(d, 'user-custom.toml'), 'x', 'utf-8');
    await removeRoleOverlayFiles({ agentsDir: d, workflowId: 'demo' });
    const remaining = (await fs.readdir(d)).sort();
    assert.deepEqual(remaining, ['antfarm-other-a.toml', 'user-custom.toml']);
  });

  it('is a no-op when directory does not exist', async () => {
    await removeRoleOverlayFiles({ agentsDir: path.join(tmp, 'ghost-dir'), workflowId: 'x' });
  });
});

describe('upsertAntfarmConfigBlock', () => {
  it('creates a new antfarm block at file end when none exists', async () => {
    const cfgPath = path.join(tmp, 'cfg-new.toml');
    await fs.writeFile(cfgPath, 'model = "gpt-5"\n\n[existing]\nkey = "value"\n', 'utf-8');
    await upsertAntfarmConfigBlock({
      configPath: cfgPath,
      entries: [
        { profileName: 'antfarm-demo-verifier', overlayPath: '~/.codex/agents/antfarm-demo-verifier.toml', description: 'Verifier', sandboxMode: 'read-only', model: 'gpt-5', reasoningEffort: 'high' },
      ],
    });
    const text = await fs.readFile(cfgPath, 'utf-8');
    assert.match(text, /^model = "gpt-5"$/m);
    assert.match(text, /\[existing\]/);
    assert.match(text, new RegExp(ANTFARM_BLOCK_BEGIN));
    assert.match(text, new RegExp(ANTFARM_BLOCK_END));
    assert.match(text, /\[profiles\."antfarm-demo-verifier"\]/);
    assert.match(text, /\[agent_roles\."antfarm-demo-verifier"\]/);
    assert.match(text, /config_file = "~\/\.codex\/agents\/antfarm-demo-verifier\.toml"/);
    const blockIdx = text.indexOf(ANTFARM_BLOCK_BEGIN);
    const existingIdx = text.indexOf('[existing]');
    assert.ok(existingIdx < blockIdx, 'antfarm block should be after user content');
  });

  it('replaces existing antfarm block in place', async () => {
    const cfgPath = path.join(tmp, 'cfg-replace.toml');
    const initial = `[user]\nkey = "value"\n\n${ANTFARM_BLOCK_BEGIN}\n[profiles."antfarm-old-agent"]\nmodel = "stale"\n${ANTFARM_BLOCK_END}\n`;
    await fs.writeFile(cfgPath, initial, 'utf-8');
    await upsertAntfarmConfigBlock({
      configPath: cfgPath,
      entries: [
        { profileName: 'antfarm-new-coder', overlayPath: '~/.codex/agents/antfarm-new-coder.toml', description: 'Coder', sandboxMode: 'workspace-write', model: 'gpt-5', reasoningEffort: 'medium' },
      ],
    });
    const text = await fs.readFile(cfgPath, 'utf-8');
    assert.doesNotMatch(text, /antfarm-old-agent/);
    assert.match(text, /antfarm-new-coder/);
    assert.equal(text.match(new RegExp(ANTFARM_BLOCK_BEGIN, 'g'))?.length, 1);
    assert.equal(text.match(new RegExp(ANTFARM_BLOCK_END, 'g'))?.length, 1);
    assert.match(text, /\[user\]/);
  });

  it('creates the file when it does not exist', async () => {
    const cfgPath = path.join(tmp, 'cfg-absent.toml');
    await upsertAntfarmConfigBlock({
      configPath: cfgPath,
      entries: [
        { profileName: 'antfarm-z-v', overlayPath: '/o.toml', description: 'd', sandboxMode: 'read-only', model: 'gpt-5', reasoningEffort: 'high' },
      ],
    });
    const text = await fs.readFile(cfgPath, 'utf-8');
    assert.match(text, /antfarm-z-v/);
  });

  it('writing an empty entries set removes the block entirely', async () => {
    const cfgPath = path.join(tmp, 'cfg-empty-replace.toml');
    const initial = `[user]\nkey = "v"\n\n${ANTFARM_BLOCK_BEGIN}\n[profiles."antfarm-x-y"]\nmodel = "m"\n${ANTFARM_BLOCK_END}\n`;
    await fs.writeFile(cfgPath, initial, 'utf-8');
    await upsertAntfarmConfigBlock({ configPath: cfgPath, entries: [] });
    const text = await fs.readFile(cfgPath, 'utf-8');
    assert.doesNotMatch(text, new RegExp(ANTFARM_BLOCK_BEGIN));
    assert.doesNotMatch(text, /antfarm-/);
    assert.match(text, /\[user\]/);
  });
});

describe('removeWorkflowEntriesFromConfigBlock', () => {
  it('removes entries matching the workflow prefix, keeps others', async () => {
    const cfgPath = path.join(tmp, 'cfg-multi-wf.toml');
    const initial = `[user]\n\n${ANTFARM_BLOCK_BEGIN}\n[profiles."antfarm-demo-a"]\nmodel = "x"\nsandbox_mode = "read-only"\nmodel_reasoning_effort = "high"\n[agent_roles."antfarm-demo-a"]\ndescription = "A"\nconfig_file = "~/a.toml"\n[profiles."antfarm-other-b"]\nmodel = "y"\nsandbox_mode = "workspace-write"\nmodel_reasoning_effort = "medium"\n[agent_roles."antfarm-other-b"]\ndescription = "B"\nconfig_file = "~/b.toml"\n${ANTFARM_BLOCK_END}\n`;
    await fs.writeFile(cfgPath, initial, 'utf-8');
    await removeWorkflowEntriesFromConfigBlock({ configPath: cfgPath, workflowId: 'demo' });
    const text = await fs.readFile(cfgPath, 'utf-8');
    assert.doesNotMatch(text, /antfarm-demo-a/);
    assert.match(text, /antfarm-other-b/);
    assert.match(text, new RegExp(ANTFARM_BLOCK_BEGIN));
  });

  it('removes the block entirely if no entries remain', async () => {
    const cfgPath = path.join(tmp, 'cfg-only-one.toml');
    const initial = `[user]\n\n${ANTFARM_BLOCK_BEGIN}\n[profiles."antfarm-demo-a"]\nmodel = "x"\nsandbox_mode = "read-only"\nmodel_reasoning_effort = "high"\n[agent_roles."antfarm-demo-a"]\ndescription = "A"\nconfig_file = "~/a.toml"\n${ANTFARM_BLOCK_END}\n`;
    await fs.writeFile(cfgPath, initial, 'utf-8');
    await removeWorkflowEntriesFromConfigBlock({ configPath: cfgPath, workflowId: 'demo' });
    const text = await fs.readFile(cfgPath, 'utf-8');
    assert.doesNotMatch(text, new RegExp(ANTFARM_BLOCK_BEGIN));
    assert.match(text, /\[user\]/);
  });

  it('no-op if config.toml has no antfarm block', async () => {
    const cfgPath = path.join(tmp, 'cfg-no-block.toml');
    const initial = `[user]\nkey = "v"\n`;
    await fs.writeFile(cfgPath, initial, 'utf-8');
    await removeWorkflowEntriesFromConfigBlock({ configPath: cfgPath, workflowId: 'demo' });
    const text = await fs.readFile(cfgPath, 'utf-8');
    assert.equal(text, initial);
  });
});
