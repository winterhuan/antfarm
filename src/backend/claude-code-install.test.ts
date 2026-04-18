import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  writeSubagentDefinition,
  removeSubagentDefinition,
  upsertClaudeSettingsPermissions,
  removeClaudeSettingsPermissions,
  ANTFARM_PERMISSION_BLOCK_KEY,
} from './claude-code-install.js';

let tmp: string;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-cc-test-'));
});
after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('writeSubagentDefinition', () => {
  it('writes a markdown file with frontmatter under .claude/agents/', async () => {
    const dir = path.join(tmp, 'sub-test-1');
    await writeSubagentDefinition({
      projectDir: dir,
      workflowId: 'wf',
      agentId: 'coder',
      role: 'coding',
      description: 'Writes code',
    });
    const content = await fs.readFile(path.join(dir, '.claude/agents/wf_coder.md'), 'utf-8');
    assert.match(content, /^---\n/);
    assert.match(content, /name: wf_coder/);
    assert.match(content, /description: Writes code/);
    assert.match(content, /role: coding/);
  });

  it('is idempotent: overwrites existing definition', async () => {
    const dir = path.join(tmp, 'sub-test-2');
    const args = { projectDir: dir, workflowId: 'wf', agentId: 'a', role: 'coding' as const, description: 'v1' };
    await writeSubagentDefinition(args);
    await writeSubagentDefinition({ ...args, description: 'v2' });
    const content = await fs.readFile(path.join(dir, '.claude/agents/wf_a.md'), 'utf-8');
    assert.match(content, /description: v2/);
    assert.doesNotMatch(content, /description: v1/);
  });

  it('rejects path-traversing agent ids', async () => {
    await assert.rejects(
      writeSubagentDefinition({
        projectDir: tmp, workflowId: 'wf', agentId: '../evil',
        role: 'coding', description: 'x',
      }),
      /unsafe/i,
    );
  });
});

describe('removeSubagentDefinition', () => {
  it('removes the agent file, leaves others alone', async () => {
    const dir = path.join(tmp, 'sub-test-3');
    await writeSubagentDefinition({ projectDir: dir, workflowId: 'wf', agentId: 'x', role: 'coding', description: 'x' });
    await writeSubagentDefinition({ projectDir: dir, workflowId: 'wf', agentId: 'y', role: 'coding', description: 'y' });
    await removeSubagentDefinition({ projectDir: dir, workflowId: 'wf', agentId: 'x' });
    const remaining = await fs.readdir(path.join(dir, '.claude/agents'));
    assert.deepEqual(remaining.sort(), ['wf_y.md']);
  });

  it('is a no-op if the file does not exist', async () => {
    const dir = path.join(tmp, 'sub-test-4');
    await fs.mkdir(path.join(dir, '.claude/agents'), { recursive: true });
    await removeSubagentDefinition({ projectDir: dir, workflowId: 'wf', agentId: 'ghost' });
    // Should not throw
  });
});

describe('upsertClaudeSettingsPermissions', () => {
  it('creates settings.json with an antfarm-marked deny block', async () => {
    const dir = path.join(tmp, 'set-test-1');
    await upsertClaudeSettingsPermissions({
      projectDir: dir,
      deny: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'],
    });
    const raw = await fs.readFile(path.join(dir, '.claude/settings.json'), 'utf-8');
    const json = JSON.parse(raw);
    assert.deepEqual(
      json.permissions.deny.slice().sort(),
      ['Edit', 'MultiEdit', 'NotebookEdit', 'Write'],
    );
    assert.ok(json[ANTFARM_PERMISSION_BLOCK_KEY], 'antfarm marker should be present');
  });

  it('preserves user-added permissions when merging', async () => {
    const dir = path.join(tmp, 'set-test-2');
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.claude/settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(git *)'], deny: ['UserCustomDeny'] } }),
      'utf-8',
    );
    await upsertClaudeSettingsPermissions({ projectDir: dir, deny: ['Write'] });
    const json = JSON.parse(await fs.readFile(path.join(dir, '.claude/settings.json'), 'utf-8'));
    assert.deepEqual(json.permissions.allow, ['Bash(git *)']);
    assert.ok(json.permissions.deny.includes('UserCustomDeny'));
    assert.ok(json.permissions.deny.includes('Write'));
  });

  it('is idempotent: re-running with same deny does not duplicate', async () => {
    const dir = path.join(tmp, 'set-test-3');
    await upsertClaudeSettingsPermissions({ projectDir: dir, deny: ['Write'] });
    await upsertClaudeSettingsPermissions({ projectDir: dir, deny: ['Write'] });
    const json = JSON.parse(await fs.readFile(path.join(dir, '.claude/settings.json'), 'utf-8'));
    const writes = json.permissions.deny.filter((d: string) => d === 'Write');
    assert.equal(writes.length, 1);
  });
});

describe('removeClaudeSettingsPermissions', () => {
  it('removes only the entries it previously added (via marker block)', async () => {
    const dir = path.join(tmp, 'set-test-4');
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.claude/settings.json'),
      JSON.stringify({ permissions: { deny: ['UserCustomDeny'] } }),
      'utf-8',
    );
    await upsertClaudeSettingsPermissions({ projectDir: dir, deny: ['Write', 'Edit'] });
    await removeClaudeSettingsPermissions({ projectDir: dir });
    const json = JSON.parse(await fs.readFile(path.join(dir, '.claude/settings.json'), 'utf-8'));
    assert.deepEqual(json.permissions.deny, ['UserCustomDeny']);
    assert.equal(json[ANTFARM_PERMISSION_BLOCK_KEY], undefined);
  });
});
