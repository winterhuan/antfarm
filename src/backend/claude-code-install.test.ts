import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  writeSubagentDefinition,
  removeSubagentDefinition,
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

  it('omits disallowedTools when not provided (coding role)', async () => {
    const dir = path.join(tmp, 'sub-test-1b');
    await writeSubagentDefinition({
      projectDir: dir, workflowId: 'wf', agentId: 'coder', role: 'coding', description: 'x',
    });
    const content = await fs.readFile(path.join(dir, '.claude/agents/wf_coder.md'), 'utf-8');
    assert.doesNotMatch(content, /disallowedTools:/);
  });

  it('writes disallowedTools into frontmatter when provided', async () => {
    const dir = path.join(tmp, 'sub-test-1c');
    await writeSubagentDefinition({
      projectDir: dir,
      workflowId: 'wf',
      agentId: 'planner',
      role: 'analysis',
      description: 'Plans work',
      disallowedTools: 'Write,Edit,MultiEdit,NotebookEdit',
    });
    const content = await fs.readFile(path.join(dir, '.claude/agents/wf_planner.md'), 'utf-8');
    assert.match(content, /disallowedTools: Write,Edit,MultiEdit,NotebookEdit/);
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

  it('rejects agent ids containing double quotes', async () => {
    await assert.rejects(
      writeSubagentDefinition({
        projectDir: tmp, workflowId: 'wf', agentId: 'ev"il',
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
