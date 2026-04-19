import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  installAntfarmSkillForClaudeCode,
  uninstallAntfarmSkillForClaudeCode,
  installAntfarmSkillForCodex,
  uninstallAntfarmSkillForCodex,
} from './skill-install.js';

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

describe('installAntfarmSkillForCodex', () => {
  let codexTmp: string;
  let originalCodexHome: string | undefined;
  before(async () => {
    codexTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-codex-skill-'));
    originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexTmp;
  });
  after(async () => {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    await fs.rm(codexTmp, { recursive: true, force: true });
  });

  it('writes SKILL.md with substituted cli path + codex-specific force-trigger text', async () => {
    const result = await installAntfarmSkillForCodex();
    assert.equal(result.installed, true);
    const skillPath = path.join(codexTmp, 'skills/antfarm-workflows/SKILL.md');
    const content = await fs.readFile(skillPath, 'utf-8');
    assert.doesNotMatch(content, /\{\{antfarmCli\}\}/);
    assert.doesNotMatch(content, /\{\{forceTriggerSection\}\}/);
    assert.match(content, /workflow tick/);
    assert.match(content, /spawn.*agent_type/);
  });

  it('uninstall removes only the antfarm-workflows skill dir', async () => {
    await installAntfarmSkillForCodex();
    await fs.mkdir(path.join(codexTmp, 'skills/sibling'), { recursive: true });
    await fs.writeFile(path.join(codexTmp, 'skills/sibling/SKILL.md'), 'x', 'utf-8');
    await uninstallAntfarmSkillForCodex();
    await assert.rejects(
      fs.access(path.join(codexTmp, 'skills/antfarm-workflows/SKILL.md')),
      /ENOENT/,
    );
    await fs.access(path.join(codexTmp, 'skills/sibling/SKILL.md'));
  });
});
