import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installAntfarmSkillForClaudeCode, uninstallAntfarmSkillForClaudeCode } from './skill-install.js';

let tmp: string;
before(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-skill-test-')); });
after(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe('installAntfarmSkillForClaudeCode', () => {
  it('writes SKILL.md with substituted cli path into .claude/skills/antfarm-workflows/', async () => {
    const result = await installAntfarmSkillForClaudeCode(tmp);
    assert.equal(result.installed, true);
    const skillPath = path.join(tmp, '.claude/skills/antfarm-workflows/SKILL.md');
    const content = await fs.readFile(skillPath, 'utf-8');
    assert.doesNotMatch(content, /\{\{antfarmCli\}\}/, 'placeholder must be substituted');
    assert.doesNotMatch(content, /\{\{forceTriggerSection\}\}/, 'placeholder must be substituted');
    assert.match(content, /workflow tick/, 'claude-code force-trigger text should appear');
  });

  it('uninstall removes only the antfarm-workflows skill dir', async () => {
    await installAntfarmSkillForClaudeCode(tmp);
    await fs.mkdir(path.join(tmp, '.claude/skills/sibling'), { recursive: true });
    await fs.writeFile(path.join(tmp, '.claude/skills/sibling/SKILL.md'), 'x', 'utf-8');
    await uninstallAntfarmSkillForClaudeCode(tmp);
    await assert.rejects(
      fs.access(path.join(tmp, '.claude/skills/antfarm-workflows/SKILL.md')),
      /ENOENT/,
    );
    await fs.access(path.join(tmp, '.claude/skills/sibling/SKILL.md'));
  });
});
