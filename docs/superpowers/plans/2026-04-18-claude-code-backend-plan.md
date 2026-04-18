# Claude Code Backend Integration - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude Code as a third antfarm backend (alongside OpenClaw and Hermes). This plan covers install/uninstall primitives only — actual `claude -p` spawning and scheduling are a follow-up plan.

**Architecture:** Implement `Backend` interface via `ClaudeCodeBackend` class. `install()` writes per-agent subagent definitions to `.claude/agents/`, merges role-based `permissions.deny` into `.claude/settings.json`, and drops the `antfarm-workflows` skill into `.claude/skills/`. `uninstall()` reverses these. `startRun` / `stopRun` are no-ops in this phase (no scheduler yet — workflows can be installed but not auto-run).

**Tech Stack:** TypeScript (strict, ESM with NodeNext + `.js` import suffix), `node:test` + `node:assert/strict`, existing antfarm infrastructure (no new runtime deps).

**Design Doc:** [2026-04-18-claude-code-backend-design.md](../specs/2026-04-18-claude-code-backend-design.md)

**Test conventions (discovered from repo):**
- Framework: `node:test` + `node:assert/strict` (NOT vitest — `tests/backend/*.test.ts` files use vitest but vitest is not installed; those tests don't run)
- Test files live co-located as `src/<path>/<name>.test.ts`, following `src/installer/status.test.ts` / `src/installer/uninstall.test.ts` precedent
- Run: `npm run build && node --test dist/<path>/<name>.test.js`

---

## File Structure

**New files:**
- `src/backend/claude-code-policy.ts` — `ROLE_DISALLOWED_TOOLS` map + `buildDisallowedTools(role)`
- `src/backend/claude-code-policy.test.ts` — unit tests for policy mapping
- `src/backend/claude-code-spawn.ts` — `buildClaudeCodeArgv()` flag composer (no actual exec in this plan)
- `src/backend/claude-code-spawn.test.ts` — unit tests for argv composition
- `src/backend/claude-code-install.ts` — `writeSubagentDefinition()` + `upsertClaudeSettingsPermissions()` helpers
- `src/backend/claude-code-install.test.ts` — unit tests with tmp-dir fixtures
- `src/backend/claude-code.ts` — `ClaudeCodeBackend` class
- `src/backend/claude-code.test.ts` — backend-level integration tests

**Modified files:**
- `src/backend/interface.ts` — extend `BackendType` union
- `src/backend/index.ts` — wire `ClaudeCodeBackend` into `createBackend`
- `src/backend/group-agents.ts` — recognize `'claude-code'` in grouping
- `src/installer/skill-install.ts` — add `installAntfarmSkillForClaudeCode()` + uninstall counterpart
- `src/installer/uninstall.ts` — call Claude Code cleanup in `uninstallAllWorkflows`
- `CLAUDE.md` — add Claude Code backend section

**Deferred to follow-up plan (NOT in scope):**
- Spawn execution (`child_process` exec of `claude -p`)
- Stream-json output parsing
- Scheduler daemon / `antfarm tick` command
- `startRun` / `stopRun` bodies (stay no-ops)
- Hooks-triggered acceleration

---

## Task 1: Extend BackendType and factory

**Files:**
- Modify: `src/backend/interface.ts:3` (BackendType union)
- Modify: `src/backend/index.ts` (createBackend switch)

- [ ] **Step 1: Extend the union type**

Edit `src/backend/interface.ts`:

```typescript
export type BackendType = 'openclaw' | 'hermes' | 'claude-code';
```

- [ ] **Step 2: Add factory case that throws until ClaudeCodeBackend exists**

Edit `src/backend/index.ts` — add case in the switch:

```typescript
case 'claude-code':
  throw new Error("ClaudeCodeBackend not yet implemented — pending task 6");
```

This is intentional scaffolding — later tasks replace the throw with the real class.

- [ ] **Step 3: Verify tsc compiles**

Run: `node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: no output (no errors)

- [ ] **Step 4: Commit**

```bash
git add src/backend/interface.ts src/backend/index.ts
git commit -m "feat(claude-code): extend BackendType union with claude-code"
```

---

## Task 2: Role policy mapping

**Files:**
- Create: `src/backend/claude-code-policy.ts`
- Test: `src/backend/claude-code-policy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/backend/claude-code-policy.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDisallowedTools, ROLE_DISALLOWED_TOOLS } from './claude-code-policy.js';

describe('buildDisallowedTools', () => {
  it('returns comma-separated write tools for analysis role', () => {
    assert.equal(buildDisallowedTools('analysis'), 'Write,Edit,MultiEdit,NotebookEdit');
  });
  it('returns empty string for coding role (no restrictions)', () => {
    assert.equal(buildDisallowedTools('coding'), '');
  });
  it('returns write tools for verification role', () => {
    assert.equal(buildDisallowedTools('verification'), 'Write,Edit,MultiEdit,NotebookEdit');
  });
  it('testing role allows NotebookEdit but denies Write/Edit/MultiEdit', () => {
    assert.equal(buildDisallowedTools('testing'), 'Write,Edit,MultiEdit');
  });
  it('pr role denies all write tools', () => {
    assert.equal(buildDisallowedTools('pr'), 'Write,Edit,MultiEdit,NotebookEdit');
  });
  it('scanning role denies all write tools', () => {
    assert.equal(buildDisallowedTools('scanning'), 'Write,Edit,MultiEdit,NotebookEdit');
  });
  it('undefined role falls back to coding (no restrictions)', () => {
    assert.equal(buildDisallowedTools(undefined), '');
  });
});
```

- [ ] **Step 2: Run test to verify it fails (module not found)**

Run: `npm run build 2>&1 | tail -5`
Expected: compile error — `Cannot find module './claude-code-policy.js'`

- [ ] **Step 3: Implement the policy module**

Create `src/backend/claude-code-policy.ts`:

```typescript
import type { AgentRole } from '../installer/types.js';

/**
 * Per-role tool deny lists for Claude Code backend. Passed to `claude -p` as
 * `--disallowedTools "<comma-separated>"`. Mirrors OpenClaw's ROLE_POLICIES
 * deny intent, enforced at the CLI flag level.
 *
 * Empty string = no restrictions (coding role).
 */
export const ROLE_DISALLOWED_TOOLS: Record<AgentRole, string> = {
  analysis:     'Write,Edit,MultiEdit,NotebookEdit',
  coding:       '',
  verification: 'Write,Edit,MultiEdit,NotebookEdit',
  testing:      'Write,Edit,MultiEdit',
  pr:           'Write,Edit,MultiEdit,NotebookEdit',
  scanning:     'Write,Edit,MultiEdit,NotebookEdit',
};

export function buildDisallowedTools(role: AgentRole | undefined): string {
  if (!role) return '';
  return ROLE_DISALLOWED_TOOLS[role] ?? '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/backend/claude-code-policy.test.js`
Expected: `pass 7  fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/backend/claude-code-policy.ts src/backend/claude-code-policy.test.ts
git commit -m "feat(claude-code): add role → disallowedTools policy mapping"
```

---

## Task 3: Flag composition helper

**Files:**
- Create: `src/backend/claude-code-spawn.ts`
- Test: `src/backend/claude-code-spawn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/backend/claude-code-spawn.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeCodeArgv } from './claude-code-spawn.js';

describe('buildClaudeCodeArgv', () => {
  it('composes canonical argv for a verification agent', () => {
    const argv = buildClaudeCodeArgv({
      role: 'verification',
      prompt: 'do the thing',
      worktreeName: 'demo-wf_verifier',
      sessionId: '11111111-1111-1111-1111-111111111111',
      maxBudgetUsd: 0.5,
      model: 'sonnet',
    });
    // Must include these in this relative order
    assert.deepEqual(argv[0], '-p');
    assert.ok(argv.includes('--bare'));
    assert.ok(argv.includes('--no-session-persistence'));
    assert.ok(argv.includes('--output-format'));
    assert.equal(argv[argv.indexOf('--output-format') + 1], 'stream-json');
    assert.ok(argv.includes('--verbose'));
    assert.ok(argv.includes('--permission-mode'));
    assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'bypassPermissions');
    assert.equal(argv[argv.indexOf('--disallowedTools') + 1], 'Write,Edit,MultiEdit,NotebookEdit');
    assert.equal(argv[argv.indexOf('--worktree') + 1], 'demo-wf_verifier');
    assert.equal(argv[argv.indexOf('--session-id') + 1], '11111111-1111-1111-1111-111111111111');
    assert.equal(argv[argv.indexOf('--max-budget-usd') + 1], '0.5');
    assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet');
    // `--` separator before prompt, prompt last
    const dashIdx = argv.indexOf('--');
    assert.ok(dashIdx > 0);
    assert.equal(argv[dashIdx + 1], 'do the thing');
    assert.equal(argv[argv.length - 1], 'do the thing');
  });

  it('omits --disallowedTools for coding role (empty deny list)', () => {
    const argv = buildClaudeCodeArgv({
      role: 'coding',
      prompt: 'p',
      worktreeName: 'w',
      sessionId: '11111111-1111-1111-1111-111111111111',
      maxBudgetUsd: 1,
      model: 'sonnet',
    });
    assert.equal(argv.indexOf('--disallowedTools'), -1);
  });

  it('throws when prompt is empty', () => {
    assert.throws(() => buildClaudeCodeArgv({
      role: 'coding', prompt: '', worktreeName: 'w',
      sessionId: '11111111-1111-1111-1111-111111111111',
      maxBudgetUsd: 1, model: 'sonnet',
    }), /prompt/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build 2>&1 | tail -5`
Expected: compile error — `Cannot find module './claude-code-spawn.js'`

- [ ] **Step 3: Implement the helper**

Create `src/backend/claude-code-spawn.ts`:

```typescript
import type { AgentRole } from '../installer/types.js';
import { buildDisallowedTools } from './claude-code-policy.js';

export interface ClaudeCodeSpawnOptions {
  role: AgentRole | undefined;
  prompt: string;
  worktreeName: string;
  sessionId: string;
  maxBudgetUsd: number;
  model: string;
}

/**
 * Compose the argv for a `claude -p` spawn. Flag order and separators follow
 * the PoC-validated canonical form (see design doc 2026-04-18). Uses `--` to
 * separate the prompt from variadic flags that would otherwise absorb it.
 */
export function buildClaudeCodeArgv(opts: ClaudeCodeSpawnOptions): string[] {
  if (!opts.prompt) {
    throw new Error('buildClaudeCodeArgv: prompt must be non-empty');
  }
  const argv: string[] = [
    '-p',
    '--bare',
    '--no-session-persistence',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    '--worktree', opts.worktreeName,
    '--session-id', opts.sessionId,
    '--max-budget-usd', String(opts.maxBudgetUsd),
    '--model', opts.model,
  ];
  const deny = buildDisallowedTools(opts.role);
  if (deny) {
    argv.push('--disallowedTools', deny);
  }
  argv.push('--', opts.prompt);
  return argv;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/backend/claude-code-spawn.test.js`
Expected: `pass 3  fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/backend/claude-code-spawn.ts src/backend/claude-code-spawn.test.ts
git commit -m "feat(claude-code): add buildClaudeCodeArgv flag composer"
```

---

## Task 4: Install helpers (subagent files + settings merge)

**Files:**
- Create: `src/backend/claude-code-install.ts`
- Test: `src/backend/claude-code-install.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/backend/claude-code-install.test.ts`:

```typescript
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
      json.permissions.deny.sort(),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build 2>&1 | tail -5`
Expected: compile error — `Cannot find module './claude-code-install.js'`

- [ ] **Step 3: Implement the helpers**

Create `src/backend/claude-code-install.ts`:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentRole } from '../installer/types.js';

export const ANTFARM_PERMISSION_BLOCK_KEY = '_antfarmManagedDeny';

function assertSafeAgentKey(key: string): void {
  // Defense against path traversal via agent id
  if (key.includes('/') || key.includes('..') || key.includes('\\')) {
    throw new Error(`Unsafe agent key "${key}"`);
  }
}

export async function writeSubagentDefinition(params: {
  projectDir: string;
  workflowId: string;
  agentId: string;
  role: AgentRole;
  description: string;
}): Promise<void> {
  const key = `${params.workflowId}_${params.agentId}`;
  assertSafeAgentKey(key);
  const agentsDir = path.join(params.projectDir, '.claude', 'agents');
  await fs.mkdir(agentsDir, { recursive: true });
  const body = `---
name: ${key}
description: ${params.description}
role: ${params.role}
---

You are the \`${key}\` workflow agent. Follow the workflow's role-specific instructions.
Claimed work is delivered via the antfarm CLI. Use read_file, grep, and the tools
permitted by your role.
`;
  await fs.writeFile(path.join(agentsDir, `${key}.md`), body, 'utf-8');
}

export async function removeSubagentDefinition(params: {
  projectDir: string;
  workflowId: string;
  agentId: string;
}): Promise<void> {
  const key = `${params.workflowId}_${params.agentId}`;
  assertSafeAgentKey(key);
  const target = path.join(params.projectDir, '.claude', 'agents', `${key}.md`);
  await fs.rm(target, { force: true });
}

interface ClaudeSettings {
  permissions?: { allow?: string[]; deny?: string[] };
  [ANTFARM_PERMISSION_BLOCK_KEY]?: string[];
  [key: string]: unknown;
}

async function readSettings(settingsPath: string): Promise<ClaudeSettings> {
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(raw) as ClaudeSettings;
  } catch {
    return {};
  }
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

export async function upsertClaudeSettingsPermissions(params: {
  projectDir: string;
  deny: string[];
}): Promise<void> {
  const dir = path.join(params.projectDir, '.claude');
  const file = path.join(dir, 'settings.json');
  await fs.mkdir(dir, { recursive: true });
  const settings = await readSettings(file);
  if (!settings.permissions) settings.permissions = {};
  const existingDeny = settings.permissions.deny ?? [];
  const ours = settings[ANTFARM_PERMISSION_BLOCK_KEY] ?? [];
  // Remove previous antfarm-managed entries, then add the current set
  const userDeny = existingDeny.filter((d) => !ours.includes(d));
  settings.permissions.deny = uniq([...userDeny, ...params.deny]);
  settings[ANTFARM_PERMISSION_BLOCK_KEY] = uniq(params.deny);
  await fs.writeFile(file, JSON.stringify(settings, null, 2), 'utf-8');
}

export async function removeClaudeSettingsPermissions(params: {
  projectDir: string;
}): Promise<void> {
  const file = path.join(params.projectDir, '.claude', 'settings.json');
  const settings = await readSettings(file);
  const ours = settings[ANTFARM_PERMISSION_BLOCK_KEY] ?? [];
  if (settings.permissions?.deny) {
    settings.permissions.deny = settings.permissions.deny.filter((d) => !ours.includes(d));
    if (settings.permissions.deny.length === 0) delete settings.permissions.deny;
    if (!settings.permissions.allow && !settings.permissions.deny) delete settings.permissions;
  }
  delete settings[ANTFARM_PERMISSION_BLOCK_KEY];
  await fs.writeFile(file, JSON.stringify(settings, null, 2), 'utf-8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/backend/claude-code-install.test.js`
Expected: `pass 7  fail 0` (2 subagent + 1 subagent-remove-idempotent + 3 upsert + 1 remove = 7)

- [ ] **Step 5: Commit**

```bash
git add src/backend/claude-code-install.ts src/backend/claude-code-install.test.ts
git commit -m "feat(claude-code): add subagent-file + settings-merge install helpers"
```

---

## Task 5: Antfarm skill install for Claude Code

**Files:**
- Modify: `src/installer/skill-install.ts` (add Claude Code variant)
- Test: reuse the same file with a new test block (existing skill-install has no test file, so add one)

- [ ] **Step 1: Add the Claude Code variant to skill-install.ts**

Append to `src/installer/skill-install.ts` (after `uninstallAntfarmSkillForHermes`):

```typescript
/**
 * Claude Code scans `<projectDir>/.claude/skills/<name>/SKILL.md` and
 * `~/.claude/skills/<name>/SKILL.md`. For antfarm we install to the project
 * directory so the skill is co-located with the workflow.
 */
function getClaudeCodeProjectSkillsDir(projectDir: string): string {
  return path.join(projectDir, ".claude", "skills");
}

const CLAUDE_CODE_FORCE_TRIGGER = `To skip the scheduled polling wait, run \`{{antfarmCli}} workflow tick <agent-id>\` (once the Claude Code backend scheduler is implemented; pending follow-up plan).`;

export async function installAntfarmSkillForClaudeCode(projectDir: string): Promise<{ installed: boolean; path: string }> {
  return writeAntfarmSkill(getClaudeCodeProjectSkillsDir(projectDir), {
    antfarmCli: `node ${resolveAntfarmCli()}`,
    forceTriggerSection: CLAUDE_CODE_FORCE_TRIGGER,
  });
}

export async function uninstallAntfarmSkillForClaudeCode(projectDir: string): Promise<void> {
  const destDir = path.join(getClaudeCodeProjectSkillsDir(projectDir), "antfarm-workflows");
  try {
    await fs.rm(destDir, { recursive: true, force: true });
  } catch {
    // Already gone
  }
}
```

Note: the template substitution in `CLAUDE_CODE_FORCE_TRIGGER` should reference `{{antfarmCli}}` since `writeAntfarmSkill` substitutes it. Wait — that won't work because the forceTrigger block is itself a substitution value. Fix by pre-substituting:

```typescript
const CLAUDE_CODE_FORCE_TRIGGER = `To skip the scheduled polling wait, run \`<ANTFARM_CLI> workflow tick <agent-id>\` (once the Claude Code backend scheduler is implemented; pending follow-up plan).`;

export async function installAntfarmSkillForClaudeCode(projectDir: string): Promise<{ installed: boolean; path: string }> {
  const cli = `node ${resolveAntfarmCli()}`;
  return writeAntfarmSkill(getClaudeCodeProjectSkillsDir(projectDir), {
    antfarmCli: cli,
    forceTriggerSection: CLAUDE_CODE_FORCE_TRIGGER.replace('<ANTFARM_CLI>', cli),
  });
}
```

- [ ] **Step 2: Create a test file**

Create `src/installer/skill-install.test.ts`:

```typescript
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
    // Plant a sibling skill that must not be touched
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
```

- [ ] **Step 3: Run tests**

Run: `npm run build && node --test dist/installer/skill-install.test.js`
Expected: `pass 2  fail 0`

- [ ] **Step 4: Commit**

```bash
git add src/installer/skill-install.ts src/installer/skill-install.test.ts
git commit -m "feat(claude-code): install antfarm-workflows skill into .claude/skills/"
```

---

## Task 6: ClaudeCodeBackend class

**Files:**
- Create: `src/backend/claude-code.ts`
- Test: `src/backend/claude-code.test.ts`
- Modify: `src/backend/index.ts` (wire up)

- [ ] **Step 1: Write the failing test**

Create `src/backend/claude-code.test.ts`:

```typescript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ClaudeCodeBackend } from './claude-code.js';
import type { WorkflowSpec } from '../installer/types.js';

let tmp: string;
const originalCwd = process.cwd();
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-cc-backend-test-'));
  process.chdir(tmp);
});
after(async () => {
  process.chdir(originalCwd);
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
    const be = new ClaudeCodeBackend(tmp);
    await be.install(makeWorkflow(), tmp);
    const entries = await fs.readdir(path.join(tmp, '.claude/agents'));
    assert.deepEqual(entries.sort(), ['demo_coder.md', 'demo_planner.md', 'demo_verifier.md']);
  });

  it('installs antfarm-workflows skill', async () => {
    const be = new ClaudeCodeBackend(tmp);
    await be.install(makeWorkflow(), tmp);
    await fs.access(path.join(tmp, '.claude/skills/antfarm-workflows/SKILL.md'));
  });

  it('merges role-based permissions.deny into settings.json', async () => {
    const be = new ClaudeCodeBackend(tmp);
    await be.install(makeWorkflow(), tmp);
    const settings = JSON.parse(await fs.readFile(path.join(tmp, '.claude/settings.json'), 'utf-8'));
    // Union of analysis + verification deny sets (coder has none)
    assert.ok(settings.permissions.deny.includes('Write'));
    assert.ok(settings.permissions.deny.includes('Edit'));
    assert.ok(settings.permissions.deny.includes('MultiEdit'));
    assert.ok(settings.permissions.deny.includes('NotebookEdit'));
  });
});

describe('ClaudeCodeBackend.uninstall', () => {
  it('removes subagent files for the workflow and the skill', async () => {
    const be = new ClaudeCodeBackend(tmp);
    await be.install(makeWorkflow(), tmp);
    await be.uninstall('demo');
    const entries = await fs.readdir(path.join(tmp, '.claude/agents')).catch(() => [] as string[]);
    assert.deepEqual(entries, []);
    await assert.rejects(
      fs.access(path.join(tmp, '.claude/skills/antfarm-workflows/SKILL.md')),
      /ENOENT/,
    );
  });

  it('removes antfarm-managed deny entries but leaves user entries intact', async () => {
    // Seed user-added deny entry
    await fs.mkdir(path.join(tmp, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, '.claude/settings.json'),
      JSON.stringify({ permissions: { deny: ['UserExtra'] } }),
      'utf-8',
    );
    const be = new ClaudeCodeBackend(tmp);
    await be.install(makeWorkflow(), tmp);
    await be.uninstall('demo');
    const settings = JSON.parse(await fs.readFile(path.join(tmp, '.claude/settings.json'), 'utf-8'));
    assert.deepEqual(settings.permissions?.deny, ['UserExtra']);
  });
});

describe('ClaudeCodeBackend.startRun / stopRun', () => {
  it('start / stop are no-ops in this phase (scheduler deferred)', async () => {
    const be = new ClaudeCodeBackend(tmp);
    // Should not throw
    await be.startRun(makeWorkflow());
    await be.stopRun(makeWorkflow());
  });
});
```

- [ ] **Step 2: Implement the class**

Create `src/backend/claude-code.ts`:

```typescript
import type { Backend } from './interface.js';
import type { WorkflowSpec } from '../installer/types.js';
import {
  writeSubagentDefinition,
  removeSubagentDefinition,
  upsertClaudeSettingsPermissions,
  removeClaudeSettingsPermissions,
} from './claude-code-install.js';
import { buildDisallowedTools } from './claude-code-policy.js';
import {
  installAntfarmSkillForClaudeCode,
  uninstallAntfarmSkillForClaudeCode,
} from '../installer/skill-install.js';

export class ClaudeCodeBackend implements Backend {
  /**
   * @param projectDir directory containing `.claude/` — defaults to process.cwd()
   *   at construction time. Tests inject a tmp dir directly.
   */
  constructor(private readonly projectDir: string = process.cwd()) {}

  async install(workflow: WorkflowSpec, _sourceDir: string): Promise<void> {
    // 1. Install the antfarm-workflows skill (main-agent entry point).
    const skillResult = await installAntfarmSkillForClaudeCode(this.projectDir);
    if (!skillResult.installed) {
      console.warn(
        `Failed to install antfarm-workflows skill to ${skillResult.path}. ` +
        `The workflow will run, but the main Claude Code agent won't expose /antfarm-workflows.`
      );
    }

    // 2. Write one subagent definition per workflow agent.
    for (const agent of workflow.agents) {
      await writeSubagentDefinition({
        projectDir: this.projectDir,
        workflowId: workflow.id,
        agentId: agent.id,
        role: agent.role ?? 'coding',
        description: agent.description ?? `${workflow.id} ${agent.id}`,
      });
    }

    // 3. Merge per-role disallowed tools into .claude/settings.json as a
    //    hard permission boundary (belt-and-suspenders with CLI flag).
    const unionDeny = new Set<string>();
    for (const agent of workflow.agents) {
      const denyStr = buildDisallowedTools(agent.role);
      if (denyStr) denyStr.split(',').forEach((t) => unionDeny.add(t));
    }
    if (unionDeny.size > 0) {
      await upsertClaudeSettingsPermissions({
        projectDir: this.projectDir,
        deny: Array.from(unionDeny),
      });
    }
  }

  async uninstall(workflowId: string): Promise<void> {
    // We don't have the workflow spec here (uninstall is called by id only),
    // so read the agents dir and remove any file starting with `<workflowId>_`.
    const agentsDir = `${this.projectDir}/.claude/agents`;
    const fs = await import('node:fs/promises');
    let entries: string[] = [];
    try { entries = await fs.readdir(agentsDir); } catch { /* dir missing is fine */ }
    const prefix = `${workflowId}_`;
    for (const name of entries) {
      if (!name.startsWith(prefix) || !name.endsWith('.md')) continue;
      const agentId = name.slice(prefix.length, -'.md'.length);
      await removeSubagentDefinition({ projectDir: this.projectDir, workflowId, agentId });
    }
    await removeClaudeSettingsPermissions({ projectDir: this.projectDir });
    await uninstallAntfarmSkillForClaudeCode(this.projectDir);
  }

  async startRun(_workflow: WorkflowSpec): Promise<void> {
    // No-op in this phase. Scheduler comes in a follow-up plan.
  }

  async stopRun(_workflow: WorkflowSpec): Promise<void> {
    // No-op in this phase.
  }
}
```

- [ ] **Step 3: Wire factory**

Edit `src/backend/index.ts` — replace the throwing `claude-code` case:

```typescript
import { ClaudeCodeBackend } from './claude-code.js';

// Inside createBackend switch:
case 'claude-code':
  return new ClaudeCodeBackend();
```

- [ ] **Step 4: Run tests**

Run: `npm run build && node --test dist/backend/claude-code.test.js`
Expected: `pass 6  fail 0` (3 install + 2 uninstall + 1 start/stop)

- [ ] **Step 5: Commit**

```bash
git add src/backend/claude-code.ts src/backend/claude-code.test.ts src/backend/index.ts
git commit -m "feat(claude-code): add ClaudeCodeBackend class and factory wiring"
```

---

## Task 7: Accept `claude-code` in backend-type validator

**Files:**
- Modify: `src/backend/config-resolver.ts:44-47` (the `validateBackendType` hardcoded check)

Context: `validateBackendType` is the single chokepoint for CLI `--backend` flag and global config validation. Without updating it, `--backend claude-code` will throw "Unknown backend type" at parse time. `group-agents.ts` is already dynamic (no-op there).

- [ ] **Step 1: Write the failing test**

Create `src/backend/config-resolver.test.ts` (or extend if it exists):

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBackendType } from './config-resolver.js';

describe('validateBackendType', () => {
  it('accepts openclaw', () => {
    assert.equal(validateBackendType('openclaw'), 'openclaw');
  });
  it('accepts hermes', () => {
    assert.equal(validateBackendType('hermes'), 'hermes');
  });
  it('accepts claude-code', () => {
    assert.equal(validateBackendType('claude-code'), 'claude-code');
  });
  it('rejects unknown backends', () => {
    assert.throws(() => validateBackendType('nope'), /Unknown backend type/);
  });
});
```

- [ ] **Step 2: Run test to verify the claude-code case fails**

Run: `npm run build && node --test dist/backend/config-resolver.test.js`
Expected: the `accepts claude-code` test FAILS with "Unknown backend type: claude-code".

- [ ] **Step 3: Update the validator**

Edit `src/backend/config-resolver.ts:44-47` — change:

```typescript
export function validateBackendType(type: string): BackendType {
  if (type !== 'openclaw' && type !== 'hermes' && type !== 'claude-code') {
    throw new Error(`Unknown backend type: ${type}. Valid values: openclaw, hermes, claude-code`);
  }
  return type as BackendType;
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run build && node --test dist/backend/config-resolver.test.js`
Expected: `pass 4  fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/backend/config-resolver.ts src/backend/config-resolver.test.ts
git commit -m "feat(claude-code): accept claude-code in validateBackendType"
```

---

## Task 8: Global uninstall integration

**Files:**
- Modify: `src/installer/uninstall.ts`

- [ ] **Step 1: Add Claude Code cleanup to uninstallAllWorkflows**

Edit `src/installer/uninstall.ts` — add after the Hermes cleanup block (around the `await uninstallAntfarmSkillForHermes();` line):

```typescript
import { uninstallAntfarmSkillForClaudeCode } from "./skill-install.js";
import { ClaudeCodeBackend } from "../backend/claude-code.js";
// ...

// Claude Code backend cleanup: iterate installed workflows, uninstall each via
// the backend, then remove the global skill.
const claudeCode = new ClaudeCodeBackend();
for (const wfId of installedWorkflowIds) {
  try {
    await claudeCode.uninstall(wfId);
  } catch (err) {
    console.warn(`Failed to uninstall Claude Code artifacts for workflow "${wfId}":`, err);
  }
}
await uninstallAntfarmSkillForClaudeCode(process.cwd());
```

- [ ] **Step 2: Verify tsc compiles**

Run: `node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add src/installer/uninstall.ts
git commit -m "feat(claude-code): wire Claude Code cleanup into uninstallAllWorkflows"
```

---

## Task 9: CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Claude Code section**

Edit `CLAUDE.md` — insert a new top-level section after the existing Hermes sections (before "## Known limitations / won't-fix"):

```markdown
## Claude Code Backend (phase 1: install/uninstall only)

The Claude Code backend writes workflow configuration into the **project's** `.claude/` directory (the repo where `antfarm workflow install` is run) rather than a per-agent profile. Artifacts:

- `.claude/agents/<workflowId>_<agentId>.md` — subagent definition per workflow agent. Users can invoke these interactively via Claude Code's Agent tool. **Antfarm does not yet drive them autonomously** — the scheduler is a follow-up.
- `.claude/settings.json` `permissions.deny` — union of role-based deny lists (Write/Edit/MultiEdit/NotebookEdit for read-only roles). Tracked under the `_antfarmManagedDeny` key so `uninstall` removes only antfarm-added entries.
- `.claude/skills/antfarm-workflows/SKILL.md` — main-agent entry point for interactive use (parallels OpenClaw / Hermes skill install).

`startRun` / `stopRun` are intentional no-ops. To advance a workflow on the Claude Code backend, use `antfarm workflow tick <agent-id>` (once the follow-up plan ships the scheduler) or invoke the subagent interactively.

**Permission model vs Hermes:** Claude Code supports per-tool deny at the CLI flag level (`--disallowedTools "Write,Edit,..."`) and at the settings.json level. Both are used: settings as the persistent default, CLI flag as the per-spawn override. This is real enforcement — PoC verified that Claude actively attempts workarounds (`printf >`, `tee`, `cd + relative`) and all are blocked.

**Required CLI flags for non-interactive use (from PoC):**
- `--permission-mode bypassPermissions` — MANDATORY. Without this, every Bash call returns "requires approval" and the `-p` session fails silently.
- `--disallowedTools "A,B,C"` — comma-separated; variadic flags eat following args, so always add `--` before the prompt.
- `--bare` — skips CLAUDE.md auto-discovery / hooks / plugin sync for cheaper, context-isolated runs (~$0.06/turn on Opus-4.7-1M vs $0.15 without `--bare`).
- `--max-budget-usd <n>` — post-hoc circuit breaker, not pre-check. Allows ~3× overshoot before tripping.
```

- [ ] **Step 2: Verify the section lands in the right place**

Run: `grep -n "^## " CLAUDE.md`
Expected: Claude Code section appears between existing sections in a sensible order.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-code): document phase-1 backend behavior and CLI flag requirements"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full build + full tests**

Run: `npm run build && node --test dist/backend/claude-code-policy.test.js dist/backend/claude-code-spawn.test.js dist/backend/claude-code-install.test.js dist/backend/claude-code.test.js dist/installer/skill-install.test.js`

Expected: all tests pass, zero failures across all 5 test files.

- [ ] **Step 2: Type check**

Run: `node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: no output (zero errors).

- [ ] **Step 3: Run pre-existing Hermes/OpenClaw tests to catch regressions**

Run: `find dist -name '*.test.js' -path '*installer*' -o -name '*.test.js' -path '*backend*' | xargs node --test`
Expected: no new failures compared to pre-plan baseline.

- [ ] **Step 4: Git log review**

Run: `git log --oneline main..HEAD` (or wherever the branch base is)
Expected: ~8 commits, each focused, messages follow `feat(claude-code):` / `docs(claude-code):` convention.

---

## Commits (expected, in order)

```
feat(claude-code): extend BackendType union with claude-code
feat(claude-code): add role → disallowedTools policy mapping
feat(claude-code): add buildClaudeCodeArgv flag composer
feat(claude-code): add subagent-file + settings-merge install helpers
feat(claude-code): install antfarm-workflows skill into .claude/skills/
feat(claude-code): add ClaudeCodeBackend class and factory wiring
feat(claude-code): accept claude-code in validateBackendType
feat(claude-code): wire Claude Code cleanup into uninstallAllWorkflows
docs(claude-code): document phase-1 backend behavior and CLI flag requirements
```

---

## Follow-up plan (NOT in scope of this plan)

These are known gaps at end of phase 1. A separate plan should cover:

1. **Spawn execution:** `child_process.spawn('claude', argv)` with stream-json parsing into discrete events (system/assistant/tool_use/tool_result/result).
2. **`antfarm workflow tick <agent>` CLI command:** one-shot manual invocation that does the equivalent of "one cron tick" — useful before a scheduler ships.
3. **Scheduler daemon (or OpenClaw Gateway adapter):** 5-minute polling loop that replaces the no-op `startRun`.
4. **Worktree cleanup on uninstall:** `--worktree` creates git worktrees; antfarm needs to track and remove stale worktrees for removed workflows.
5. **Cost telemetry:** aggregate `total_cost_usd` from each spawn's JSON output into per-workflow run dashboards.
6. **SessionStart hook (Path D supplement):** opportunistic advancement when a human opens Claude Code.
