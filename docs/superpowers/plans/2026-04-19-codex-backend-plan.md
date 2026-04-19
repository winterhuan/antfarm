# Codex Backend Integration - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex (OpenAI's `codex-cli`) as antfarm's fourth backend — phase 1 covers install/uninstall primitives using Path Z (both `[profiles.*]` and `[agent_roles.*]` in `~/.codex/config.toml`, sharing one role overlay TOML per workflow agent).

**Architecture:** `CodexBackend` class implementing the `Backend` interface. `install()` writes per-agent role overlay TOMLs to `~/.codex/agents/antfarm-<wf>-<agent>.toml`, maintains a marker-delimited antfarm-managed block at the end of `~/.codex/config.toml` containing matching `[profiles.*]` and `[agent_roles.*]` entries, and installs the `antfarm-workflows` skill globally to `~/.codex/skills/`. `uninstall()` reverses all three. `startRun` / `stopRun` are no-ops in this phase (shared scheduler is a follow-up plan with Claude Code). No TOML parser dependency — marker-block line rewriting only.

**Tech Stack:** TypeScript (strict, ESM + NodeNext + `.js` import suffix), `node:test` + `node:assert/strict`, existing antfarm infrastructure (no new deps).

**Design Doc:** [2026-04-19-codex-backend-design.md](../specs/2026-04-19-codex-backend-design.md)

**Test conventions (same as Claude Code plan):**
- Framework: `node:test` + `node:assert/strict` (NOT vitest — `tests/backend/*.test.ts` files use vitest but vitest is not installed; those tests don't run)
- Test files live co-located as `src/<path>/<name>.test.ts`
- Build: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build`
- Run: `node --test dist/<path>/<name>.test.js`
- Typecheck: `node_modules/.bin/tsc -p tsconfig.json --noEmit`

---

## File Structure

**New files:**
- `src/backend/codex-policy.ts` — `ROLE_SANDBOX` map + `getCodexSandboxMode(role)` + `buildRoleDeveloperInstructions(role, workflowId, agentId)`
- `src/backend/codex-policy.test.ts` — unit tests
- `src/backend/codex-spawn.ts` — `buildCodexExecArgv()` composer (called by scheduler in phase 2 — plan ships it now so the layer is ready)
- `src/backend/codex-spawn.test.ts` — unit tests
- `src/backend/codex-config.ts` — marker-delimited config.toml block read/rewrite + role overlay TOML writer
- `src/backend/codex-config.test.ts` — tmp-dir fixture tests
- `src/backend/codex.ts` — `CodexBackend` class
- `src/backend/codex.test.ts` — integration-style tests (tmp CODEX_HOME)

**Modified files:**
- `src/backend/interface.ts` — extend `BackendType` union
- `src/backend/index.ts` — wire `CodexBackend` into `createBackend`
- `src/backend/config-resolver.ts` — accept `'codex'` in `validateBackendType`
- `src/backend/config-resolver.test.ts` — add `'codex'` case
- `src/installer/skill-install.ts` — add `installAntfarmSkillForCodex` + uninstall counterpart
- `src/installer/skill-install.test.ts` — +2 tests for Codex skill install
- `src/installer/uninstall.ts` — wire Codex cleanup into `uninstallAllWorkflows`
- `CLAUDE.md` — add Codex backend section

**Deferred to follow-up plan (NOT in scope):**
- Real `codex exec` subprocess execution
- Stream-json parsing of Codex JSONL event output
- Scheduler daemon / `antfarm workflow tick <agent>` CLI command
- `startRun` / `stopRun` bodies stay no-ops
- Worktree handling for workflow workspace isolation

---

## Task 1: Extend BackendType and factory

**Files:**
- Modify: `src/backend/interface.ts:3` (BackendType union)
- Modify: `src/backend/index.ts` (createBackend switch)

- [ ] **Step 1: Extend the union type**

Edit `src/backend/interface.ts`:

```typescript
export type BackendType = 'openclaw' | 'hermes' | 'claude-code' | 'codex';
```

- [ ] **Step 2: Add factory case that throws until CodexBackend exists**

Edit `src/backend/index.ts` — add case in the switch before the default:

```typescript
case 'codex':
  throw new Error("CodexBackend not yet implemented — pending task 8");
```

- [ ] **Step 3: Verify tsc compiles**

Run: `node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add src/backend/interface.ts src/backend/index.ts
git commit -m "feat(codex): extend BackendType union with codex"
```

---

## Task 2: Role policy mapping (sandbox + developer_instructions)

**Files:**
- Create: `src/backend/codex-policy.ts`
- Test: `src/backend/codex-policy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/backend/codex-policy.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_SANDBOX,
  getCodexSandboxMode,
  buildRoleDeveloperInstructions,
} from './codex-policy.js';

describe('getCodexSandboxMode', () => {
  it('maps analysis to read-only', () => {
    assert.equal(getCodexSandboxMode('analysis'), 'read-only');
  });
  it('maps coding to workspace-write', () => {
    assert.equal(getCodexSandboxMode('coding'), 'workspace-write');
  });
  it('maps verification to read-only', () => {
    assert.equal(getCodexSandboxMode('verification'), 'read-only');
  });
  it('maps testing to workspace-write', () => {
    assert.equal(getCodexSandboxMode('testing'), 'workspace-write');
  });
  it('maps pr to read-only', () => {
    assert.equal(getCodexSandboxMode('pr'), 'read-only');
  });
  it('maps scanning to read-only', () => {
    assert.equal(getCodexSandboxMode('scanning'), 'read-only');
  });
  it('undefined role defaults to workspace-write (coding)', () => {
    assert.equal(getCodexSandboxMode(undefined), 'workspace-write');
  });
});

describe('buildRoleDeveloperInstructions', () => {
  it('includes workflow + agent id + role in the text', () => {
    const text = buildRoleDeveloperInstructions('verification', 'feature-dev', 'verifier');
    assert.match(text, /feature-dev/);
    assert.match(text, /verifier/);
    assert.match(text, /verification/);
  });
  it('for read-only roles, mentions DO NOT call write tools', () => {
    const text = buildRoleDeveloperInstructions('verification', 'wf', 'a');
    assert.match(text, /DO NOT.*write|read-only/i);
  });
  it('for coding role, does not inject read-only guardrail', () => {
    const text = buildRoleDeveloperInstructions('coding', 'wf', 'a');
    assert.doesNotMatch(text, /DO NOT call write_file/i);
  });
});

describe('ROLE_SANDBOX', () => {
  it('covers all AgentRole variants', () => {
    const roles = ['analysis', 'coding', 'verification', 'testing', 'pr', 'scanning'] as const;
    for (const r of roles) {
      assert.ok(r in ROLE_SANDBOX, `missing role ${r}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build 2>&1 | tail -3`
Expected: compile error — `Cannot find module './codex-policy.js'`

- [ ] **Step 3: Implement the module**

Create `src/backend/codex-policy.ts`:

```typescript
import type { AgentRole } from '../installer/types.js';

/**
 * Codex's three sandbox modes. Syscall-level enforcement (macOS seatbelt /
 * Linux landlock). `read-only` blocks all writes, `workspace-write` allows
 * writes within `--cd` + `--add-dir` paths only.
 */
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * Map antfarm agent role to Codex sandbox mode. Read-only roles can still
 * execute trusted commands (ls, cat, tests) — they're blocked from WRITES,
 * not from reading or running.
 */
export const ROLE_SANDBOX: Record<AgentRole, CodexSandboxMode> = {
  analysis:     'read-only',       // read + grep, no modifications
  coding:       'workspace-write', // full dev access within workspace
  verification: 'read-only',       // run lint/typecheck/tests, no fixes
  testing:      'workspace-write', // tests may produce artifacts
  pr:           'read-only',       // git/gh on already-committed changes
  scanning:     'read-only',       // static analysis + web lookups
};

export function getCodexSandboxMode(role: AgentRole | undefined): CodexSandboxMode {
  if (!role) return 'workspace-write';
  return ROLE_SANDBOX[role] ?? 'workspace-write';
}

/**
 * Role-specific developer_instructions text written into the role overlay
 * TOML. Appended to Codex's built-in prompt when the role is active.
 */
export function buildRoleDeveloperInstructions(
  role: AgentRole | undefined,
  workflowId: string,
  agentId: string,
): string {
  const header = `You are the antfarm ${workflowId}/${agentId} agent (role: ${role ?? 'coding'}).`;
  if (!role || role === 'coding') return header;

  const guardrails: Record<Exclude<AgentRole, 'coding'>, string> = {
    analysis:
      'You are in ANALYSIS mode. DO NOT call write_file, edit, or apply_patch. Read, grep, and search freely. Put proposed changes in your text output — do not apply them.',
    verification:
      'You are in VERIFICATION mode. The sandbox is read-only — writes will fail at syscall level. Run lint/typecheck/tests via shell and report PASS or FAIL.',
    testing:
      'You are in TESTING mode. Run the existing test suite and report results. You may edit test files if the work input explicitly asks for it, but DO NOT modify application source code.',
    pr:
      'You are in PR mode. Create or update pull requests from already-committed changes using git and gh. DO NOT edit source files or tests.',
    scanning:
      'You are in SCANNING mode. You are read-only. Use read_file, grep, search, and web_search to find vulnerabilities. Output findings; do not fix them.',
  };

  return `${header}\n\n${guardrails[role as Exclude<AgentRole, 'coding'>]}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build && node --test dist/backend/codex-policy.test.js`
Expected: `pass 11  fail 0` (7 sandbox + 3 instructions + 1 map coverage)

- [ ] **Step 5: Commit**

```bash
git add src/backend/codex-policy.ts src/backend/codex-policy.test.ts
git commit -m "feat(codex): add role → sandbox mode + developer_instructions policy"
```

---

## Task 3: Flag composition helper for `codex exec`

**Files:**
- Create: `src/backend/codex-spawn.ts`
- Test: `src/backend/codex-spawn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/backend/codex-spawn.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexExecArgv } from './codex-spawn.js';

describe('buildCodexExecArgv', () => {
  it('composes canonical argv with profile + --cd + prompt', () => {
    const argv = buildCodexExecArgv({
      profileName: 'antfarm-demo-verifier',
      workspaceDir: '/tmp/workspace',
      prompt: 'do the thing',
      lastMessagePath: '/tmp/last-msg.txt',
    });
    // First positional is the subcommand
    assert.equal(argv[0], 'exec');
    assert.ok(argv.includes('--json'));
    assert.ok(argv.includes('--ephemeral'));
    assert.ok(argv.includes('--skip-git-repo-check'));
    assert.equal(argv[argv.indexOf('--cd') + 1], '/tmp/workspace');
    assert.equal(argv[argv.indexOf('--profile') + 1], 'antfarm-demo-verifier');
    assert.equal(argv[argv.indexOf('--output-last-message') + 1], '/tmp/last-msg.txt');
    // `--` separator before the prompt
    const dashIdx = argv.indexOf('--');
    assert.ok(dashIdx > 0);
    assert.equal(argv[dashIdx + 1], 'do the thing');
    assert.equal(argv[argv.length - 1], 'do the thing');
  });

  it('supports additional writable directories via --add-dir', () => {
    const argv = buildCodexExecArgv({
      profileName: 'antfarm-demo-coder',
      workspaceDir: '/tmp/workspace',
      prompt: 'p',
      lastMessagePath: '/tmp/out.txt',
      addDirs: ['/tmp/extra-a', '/tmp/extra-b'],
    });
    // Both --add-dir entries present
    const occurrences = argv.filter((v) => v === '--add-dir').length;
    assert.equal(occurrences, 2);
    assert.ok(argv.includes('/tmp/extra-a'));
    assert.ok(argv.includes('/tmp/extra-b'));
  });

  it('throws when prompt is empty', () => {
    assert.throws(() => buildCodexExecArgv({
      profileName: 'p', workspaceDir: '/tmp', prompt: '', lastMessagePath: '/tmp/x',
    }), /prompt/i);
  });

  it('throws when profileName is empty', () => {
    assert.throws(() => buildCodexExecArgv({
      profileName: '', workspaceDir: '/tmp', prompt: 'p', lastMessagePath: '/tmp/x',
    }), /profile/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build 2>&1 | tail -3`
Expected: compile error — `Cannot find module './codex-spawn.js'`

- [ ] **Step 3: Implement the helper**

Create `src/backend/codex-spawn.ts`:

```typescript
export interface CodexExecSpawnOptions {
  profileName: string;
  workspaceDir: string;
  prompt: string;
  lastMessagePath: string;
  addDirs?: string[];
}

/**
 * Compose argv for a `codex exec` spawn. Flag order matches the PoC-validated
 * canonical form (see design doc 2026-04-19). The profile supplies model,
 * sandbox_mode, reasoning effort, and developer_instructions — scheduler only
 * needs to pass workspace + prompt + last-message file.
 *
 * Uses `--` to separate the prompt from any variadic flag that might otherwise
 * absorb it.
 */
export function buildCodexExecArgv(opts: CodexExecSpawnOptions): string[] {
  if (!opts.prompt) {
    throw new Error('buildCodexExecArgv: prompt must be non-empty');
  }
  if (!opts.profileName) {
    throw new Error('buildCodexExecArgv: profileName must be non-empty');
  }
  const argv: string[] = [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--cd', opts.workspaceDir,
    '--profile', opts.profileName,
    '--output-last-message', opts.lastMessagePath,
  ];
  for (const dir of opts.addDirs ?? []) {
    argv.push('--add-dir', dir);
  }
  argv.push('--', opts.prompt);
  return argv;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build && node --test dist/backend/codex-spawn.test.js`
Expected: `pass 4  fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/backend/codex-spawn.ts src/backend/codex-spawn.test.ts
git commit -m "feat(codex): add buildCodexExecArgv flag composer"
```

---

## Task 4: Config.toml marker block + role overlay file writer

**Files:**
- Create: `src/backend/codex-config.ts`
- Test: `src/backend/codex-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/backend/codex-config.test.ts`:

```typescript
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
    // Multi-line developer_instructions uses triple-quoted string
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
    // The raw """ sequence in input must not break the containing block.
    // Simplest escape: replace inner `"""` with `""\"`
    assert.doesNotMatch(text.replace(/^developer_instructions = """\n|\n"""$/gm, ''), /"""/);
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
    // Should not throw
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
    assert.match(text, /^model = "gpt-5"$/m); // user content preserved
    assert.match(text, /\[existing\]/); // user section preserved
    assert.match(text, new RegExp(ANTFARM_BLOCK_BEGIN));
    assert.match(text, new RegExp(ANTFARM_BLOCK_END));
    assert.match(text, /\[profiles\."antfarm-demo-verifier"\]/);
    assert.match(text, /\[agent_roles\."antfarm-demo-verifier"\]/);
    assert.match(text, /config_file = "~\/\.codex\/agents\/antfarm-demo-verifier\.toml"/);
    // Block sits at end of file
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
    // Only ONE begin/end pair exists
    assert.equal(text.match(new RegExp(ANTFARM_BLOCK_BEGIN, 'g'))?.length, 1);
    assert.equal(text.match(new RegExp(ANTFARM_BLOCK_END, 'g'))?.length, 1);
    // User content still there
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
    const initial = `[user]\n\n${ANTFARM_BLOCK_BEGIN}\n[profiles."antfarm-demo-a"]\nmodel = "x"\n[agent_roles."antfarm-demo-a"]\nconfig_file = "~/a.toml"\n[profiles."antfarm-other-b"]\nmodel = "y"\n[agent_roles."antfarm-other-b"]\nconfig_file = "~/b.toml"\n${ANTFARM_BLOCK_END}\n`;
    await fs.writeFile(cfgPath, initial, 'utf-8');
    await removeWorkflowEntriesFromConfigBlock({ configPath: cfgPath, workflowId: 'demo' });
    const text = await fs.readFile(cfgPath, 'utf-8');
    assert.doesNotMatch(text, /antfarm-demo-a/);
    assert.match(text, /antfarm-other-b/);
    // Block still exists (still has content)
    assert.match(text, new RegExp(ANTFARM_BLOCK_BEGIN));
  });

  it('removes the block entirely if no entries remain', async () => {
    const cfgPath = path.join(tmp, 'cfg-only-one.toml');
    const initial = `[user]\n\n${ANTFARM_BLOCK_BEGIN}\n[profiles."antfarm-demo-a"]\nmodel = "x"\n[agent_roles."antfarm-demo-a"]\nconfig_file = "~/a.toml"\n${ANTFARM_BLOCK_END}\n`;
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build 2>&1 | tail -3`
Expected: compile error — `Cannot find module './codex-config.js'`

- [ ] **Step 3: Implement the module**

Create `src/backend/codex-config.ts`:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CodexSandboxMode } from './codex-policy.js';

export const ANTFARM_BLOCK_BEGIN = '# BEGIN antfarm-managed';
export const ANTFARM_BLOCK_END = '# END antfarm-managed';

export interface AntfarmConfigEntry {
  profileName: string;              // e.g. "antfarm-feature-dev-verifier"
  overlayPath: string;              // e.g. "~/.codex/agents/antfarm-feature-dev-verifier.toml"
  description: string;              // human-facing role description
  sandboxMode: CodexSandboxMode;
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
}

/**
 * Escape a string for inclusion inside a TOML triple-quoted basic string.
 * The only character we need to handle is the literal triple-quote sequence.
 */
function escapeTomlTripleQuoted(s: string): string {
  return s.replace(/"""/g, '""\\"');
}

function tomlBasicString(s: string): string {
  return JSON.stringify(s);
}

export async function writeRoleOverlayFile(params: {
  filePath: string;
  model: string;
  sandboxMode: CodexSandboxMode;
  modelReasoningEffort: 'low' | 'medium' | 'high';
  developerInstructions: string;
}): Promise<void> {
  const lines: string[] = [
    '# Managed by antfarm — overwritten on `antfarm workflow install`. Do not edit.',
    '',
    `model = ${tomlBasicString(params.model)}`,
    `sandbox_mode = ${tomlBasicString(params.sandboxMode)}`,
    `model_reasoning_effort = ${tomlBasicString(params.modelReasoningEffort)}`,
    '',
    'developer_instructions = """',
    escapeTomlTripleQuoted(params.developerInstructions),
    '"""',
    '',
  ];
  await fs.mkdir(path.dirname(params.filePath), { recursive: true });
  await fs.writeFile(params.filePath, lines.join('\n'), 'utf-8');
}

export async function removeRoleOverlayFiles(params: {
  agentsDir: string;
  workflowId: string;
}): Promise<void> {
  const prefix = `antfarm-${params.workflowId}-`;
  let entries: string[] = [];
  try { entries = await fs.readdir(params.agentsDir); } catch { return; }
  for (const name of entries) {
    if (name.startsWith(prefix) && name.endsWith('.toml')) {
      await fs.rm(path.join(params.agentsDir, name), { force: true });
    }
  }
}

function formatAntfarmBlock(entries: AntfarmConfigEntry[]): string {
  if (entries.length === 0) return '';
  const parts: string[] = [ANTFARM_BLOCK_BEGIN];
  for (const e of entries) {
    parts.push('');
    parts.push(`[profiles.${tomlBasicString(e.profileName)}]`);
    parts.push(`model = ${tomlBasicString(e.model)}`);
    parts.push(`sandbox_mode = ${tomlBasicString(e.sandboxMode)}`);
    parts.push(`model_reasoning_effort = ${tomlBasicString(e.reasoningEffort)}`);
    parts.push('');
    parts.push(`[agent_roles.${tomlBasicString(e.profileName)}]`);
    parts.push(`description = ${tomlBasicString(e.description)}`);
    parts.push(`config_file = ${tomlBasicString(e.overlayPath)}`);
  }
  parts.push(ANTFARM_BLOCK_END);
  return parts.join('\n') + '\n';
}

function stripExistingBlock(content: string): string {
  const beginIdx = content.indexOf(ANTFARM_BLOCK_BEGIN);
  if (beginIdx === -1) return content;
  const endIdx = content.indexOf(ANTFARM_BLOCK_END, beginIdx);
  if (endIdx === -1) return content;
  const after = endIdx + ANTFARM_BLOCK_END.length;
  // Consume trailing newline after END marker if present
  const tail = content.slice(after).replace(/^\n/, '');
  const head = content.slice(0, beginIdx).replace(/\s+$/, '');
  if (!head) return tail;
  if (!tail) return head + '\n';
  return head + '\n\n' + tail;
}

export async function upsertAntfarmConfigBlock(params: {
  configPath: string;
  entries: AntfarmConfigEntry[];
}): Promise<void> {
  let content = '';
  try { content = await fs.readFile(params.configPath, 'utf-8'); } catch { /* new file */ }

  const stripped = stripExistingBlock(content);
  const block = formatAntfarmBlock(params.entries);

  let final: string;
  if (!block) {
    final = stripped;
  } else if (!stripped.trim()) {
    final = block;
  } else {
    final = stripped.replace(/\s+$/, '') + '\n\n' + block;
  }

  await fs.mkdir(path.dirname(params.configPath), { recursive: true });
  await fs.writeFile(params.configPath, final, 'utf-8');
}

/**
 * Parse the antfarm block and return all entries that do NOT match the given
 * workflow prefix. Then rewrite the block with those entries. If no entries
 * remain, the whole block is removed.
 */
export async function removeWorkflowEntriesFromConfigBlock(params: {
  configPath: string;
  workflowId: string;
}): Promise<void> {
  let content = '';
  try { content = await fs.readFile(params.configPath, 'utf-8'); } catch { return; }
  if (!content.includes(ANTFARM_BLOCK_BEGIN)) return;

  const beginIdx = content.indexOf(ANTFARM_BLOCK_BEGIN);
  const endIdx = content.indexOf(ANTFARM_BLOCK_END, beginIdx);
  if (endIdx === -1) return;
  const block = content.slice(beginIdx, endIdx + ANTFARM_BLOCK_END.length);

  const kept: AntfarmConfigEntry[] = parseAntfarmBlock(block).filter(
    (e) => !e.profileName.startsWith(`antfarm-${params.workflowId}-`),
  );

  await upsertAntfarmConfigBlock({ configPath: params.configPath, entries: kept });
}

/**
 * Parse a single antfarm-managed block back into entries. This is a narrow
 * parser: it only recognizes the shape that `formatAntfarmBlock` emits.
 */
export function parseAntfarmBlock(block: string): AntfarmConfigEntry[] {
  const entries: Map<string, Partial<AntfarmConfigEntry> & { profileName: string }> = new Map();
  const lines = block.split('\n');
  let currentName: string | null = null;
  let currentSection: 'profile' | 'role' | null = null;
  for (const line of lines) {
    const profMatch = line.match(/^\[profiles\."([^"]+)"\]$/);
    if (profMatch) {
      currentName = profMatch[1];
      currentSection = 'profile';
      if (!entries.has(currentName)) {
        entries.set(currentName, { profileName: currentName });
      }
      continue;
    }
    const roleMatch = line.match(/^\[agent_roles\."([^"]+)"\]$/);
    if (roleMatch) {
      currentName = roleMatch[1];
      currentSection = 'role';
      if (!entries.has(currentName)) {
        entries.set(currentName, { profileName: currentName });
      }
      continue;
    }
    if (!currentName || !currentSection) continue;
    const kvMatch = line.match(/^([a-z_]+)\s*=\s*"([^"]*)"$/);
    if (!kvMatch) continue;
    const [, key, value] = kvMatch;
    const entry = entries.get(currentName)!;
    if (currentSection === 'profile') {
      if (key === 'model') entry.model = value;
      else if (key === 'sandbox_mode') entry.sandboxMode = value as CodexSandboxMode;
      else if (key === 'model_reasoning_effort') entry.reasoningEffort = value as 'low' | 'medium' | 'high';
    } else {
      if (key === 'description') entry.description = value;
      else if (key === 'config_file') entry.overlayPath = value;
    }
  }
  const result: AntfarmConfigEntry[] = [];
  for (const e of entries.values()) {
    if (e.model && e.sandboxMode && e.reasoningEffort && e.description && e.overlayPath) {
      result.push(e as AntfarmConfigEntry);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build && node --test dist/backend/codex-config.test.js`
Expected: `pass 11  fail 0` (2 overlay + 2 remove-overlay + 4 upsert + 3 remove-workflow-entries)

- [ ] **Step 5: Commit**

```bash
git add src/backend/codex-config.ts src/backend/codex-config.test.ts
git commit -m "feat(codex): add marker-block config.toml manager + role overlay writer"
```

---

## Task 5: Antfarm skill install for Codex

**Files:**
- Modify: `src/installer/skill-install.ts`
- Modify: `src/installer/skill-install.test.ts`

- [ ] **Step 1: Add the Codex variant to skill-install.ts**

Append to `src/installer/skill-install.ts` (after `uninstallAntfarmSkillForClaudeCode`):

```typescript
/**
 * Codex scans `$CODEX_HOME/skills/<skill-name>/SKILL.md` (defaults to
 * `~/.codex/skills/`). Global per-user, same pattern as Hermes.
 */
function getCodexUserSkillsDir(): string {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "skills");
}

export async function installAntfarmSkillForCodex(): Promise<{ installed: boolean; path: string }> {
  const cli = `node ${resolveAntfarmCli()}`;
  const forceTrigger = `To skip the scheduled polling wait, run \`${cli} workflow tick <agent-id>\` (once the Codex backend scheduler is implemented; pending follow-up plan). You may also invoke the antfarm subagent interactively from the Codex main agent: use the \`spawn\` tool with \`agent_type="antfarm-<workflow-id>-<agent-id>"\`.`;
  return writeAntfarmSkill(getCodexUserSkillsDir(), {
    antfarmCli: cli,
    forceTriggerSection: forceTrigger,
  });
}

export async function uninstallAntfarmSkillForCodex(): Promise<void> {
  const destDir = path.join(getCodexUserSkillsDir(), "antfarm-workflows");
  try {
    await fs.rm(destDir, { recursive: true, force: true });
  } catch {
    // Already gone
  }
}
```

- [ ] **Step 2: Add tests to skill-install.test.ts**

Append to `src/installer/skill-install.test.ts`:

```typescript
import { installAntfarmSkillForCodex, uninstallAntfarmSkillForCodex } from './skill-install.js';

describe('installAntfarmSkillForCodex', () => {
  let codexTmp: string;
  before(async () => {
    codexTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'antfarm-codex-skill-'));
    process.env.CODEX_HOME = codexTmp;
  });
  after(async () => {
    delete process.env.CODEX_HOME;
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
```

- [ ] **Step 3: Run tests**

Run: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build && node --test dist/installer/skill-install.test.js`
Expected: `pass 4  fail 0` (2 Claude Code + 2 Codex)

- [ ] **Step 4: Commit**

```bash
git add src/installer/skill-install.ts src/installer/skill-install.test.ts
git commit -m "feat(codex): install antfarm-workflows skill into ~/.codex/skills/"
```

---

## Task 6: CodexBackend class

**Files:**
- Create: `src/backend/codex.ts`
- Test: `src/backend/codex.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/backend/codex.test.ts`:

```typescript
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CodexBackend } from './codex.js';
import { ANTFARM_BLOCK_BEGIN, ANTFARM_BLOCK_END } from './codex-config.js';
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
  // Clean tmp CODEX_HOME between tests
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
    assert.match(cfg, new RegExp(ANTFARM_BLOCK_END));
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
```

- [ ] **Step 2: Implement the class**

Create `src/backend/codex.ts`:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import type { Backend } from './interface.js';
import type { WorkflowSpec } from '../installer/types.js';
import {
  writeRoleOverlayFile,
  removeRoleOverlayFiles,
  upsertAntfarmConfigBlock,
  removeWorkflowEntriesFromConfigBlock,
  parseAntfarmBlock,
  ANTFARM_BLOCK_BEGIN,
  ANTFARM_BLOCK_END,
  type AntfarmConfigEntry,
} from './codex-config.js';
import {
  getCodexSandboxMode,
  buildRoleDeveloperInstructions,
} from './codex-policy.js';
import {
  installAntfarmSkillForCodex,
  uninstallAntfarmSkillForCodex,
} from '../installer/skill-install.js';

const DEFAULT_MODEL = 'gpt-5.3-codex';
const DEFAULT_REASONING: 'low' | 'medium' | 'high' = 'high';

export class CodexBackend implements Backend {
  private getCodexHome(): string {
    return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  }

  private getAgentsDir(): string {
    return path.join(this.getCodexHome(), 'agents');
  }

  private getConfigPath(): string {
    return path.join(this.getCodexHome(), 'config.toml');
  }

  private assertSafeAgentKey(workflowId: string, agentId: string): void {
    const key = `${workflowId}-${agentId}`;
    if (key.includes('/') || key.includes('..') || key.includes('\\') || key.includes('"')) {
      throw new Error(`Unsafe workflow/agent id combination: "${workflowId}" / "${agentId}"`);
    }
  }

  private profileName(workflowId: string, agentId: string): string {
    return `antfarm-${workflowId}-${agentId}`;
  }

  private overlayPath(workflowId: string, agentId: string): string {
    return path.join(this.getAgentsDir(), `${this.profileName(workflowId, agentId)}.toml`);
  }

  async install(workflow: WorkflowSpec, _sourceDir: string): Promise<void> {
    const skillResult = await installAntfarmSkillForCodex();
    if (!skillResult.installed) {
      console.warn(
        `Failed to install antfarm-workflows skill to ${skillResult.path}. ` +
        `The workflow will run, but the Codex main agent won't surface /antfarm-workflows.`
      );
    }

    // 1. Write one role overlay TOML per agent.
    for (const agent of workflow.agents) {
      this.assertSafeAgentKey(workflow.id, agent.id);
      const overlayPath = this.overlayPath(workflow.id, agent.id);
      await writeRoleOverlayFile({
        filePath: overlayPath,
        model: agent.model ?? DEFAULT_MODEL,
        sandboxMode: getCodexSandboxMode(agent.role),
        modelReasoningEffort: DEFAULT_REASONING,
        developerInstructions: buildRoleDeveloperInstructions(agent.role, workflow.id, agent.id),
      });
    }

    // 2. Rewrite the antfarm block in config.toml with ALL installed workflow
    //    agents — preserving entries from OTHER workflows.
    const existingEntries = await this.readExistingOtherWorkflowEntries(workflow.id);
    const newEntries: AntfarmConfigEntry[] = workflow.agents.map((agent) => ({
      profileName: this.profileName(workflow.id, agent.id),
      overlayPath: this.overlayPath(workflow.id, agent.id),
      description: `antfarm ${workflow.id}/${agent.id} (${agent.role ?? 'coding'})`,
      sandboxMode: getCodexSandboxMode(agent.role),
      model: agent.model ?? DEFAULT_MODEL,
      reasoningEffort: DEFAULT_REASONING,
    }));
    await upsertAntfarmConfigBlock({
      configPath: this.getConfigPath(),
      entries: [...existingEntries, ...newEntries],
    });
  }

  async uninstall(workflowId: string): Promise<void> {
    // 1. Remove overlay TOMLs for this workflow.
    await removeRoleOverlayFiles({ agentsDir: this.getAgentsDir(), workflowId });

    // 2. Remove matching profiles/agent_roles entries from config.toml.
    await removeWorkflowEntriesFromConfigBlock({
      configPath: this.getConfigPath(),
      workflowId,
    });

    // 3. If no antfarm block remains, also uninstall the skill.
    const cfg = await fs.readFile(this.getConfigPath(), 'utf-8').catch(() => '');
    if (!cfg.includes(ANTFARM_BLOCK_BEGIN)) {
      await uninstallAntfarmSkillForCodex();
    }
  }

  async startRun(_workflow: WorkflowSpec): Promise<void> {
    // No-op in phase 1. Scheduler is a shared follow-up plan.
  }

  async stopRun(_workflow: WorkflowSpec): Promise<void> {
    // No-op in phase 1.
  }

  /**
   * Read current antfarm block and return entries NOT owned by `excludeWorkflowId`.
   * Used during install to preserve other workflows' entries when rewriting the block.
   */
  private async readExistingOtherWorkflowEntries(excludeWorkflowId: string): Promise<AntfarmConfigEntry[]> {
    const prefix = `antfarm-${excludeWorkflowId}-`;
    const cfg = await fs.readFile(this.getConfigPath(), 'utf-8').catch(() => '');
    if (!cfg.includes(ANTFARM_BLOCK_BEGIN)) return [];

    const beginIdx = cfg.indexOf(ANTFARM_BLOCK_BEGIN);
    const endIdx = cfg.indexOf(ANTFARM_BLOCK_END, beginIdx);
    if (endIdx === -1) return [];
    const block = cfg.slice(beginIdx, endIdx);
    return parseAntfarmBlock(block).filter((e) => !e.profileName.startsWith(prefix));
  }
}
```

**Note:** Task 4 already exports `parseAntfarmBlock` — verify the export line says `export function parseAntfarmBlock` in your implementation of Task 4.

- [ ] **Step 3: Wire factory**

Edit `src/backend/index.ts` — replace the throwing `codex` case:

```typescript
import { CodexBackend } from './codex.js';

// Inside createBackend switch — replace the throw:
case 'codex':
  return new CodexBackend();
```

- [ ] **Step 4: Run tests**

Run: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build && node --test dist/backend/codex.test.js`
Expected: `pass 9  fail 0` (6 install + 2 uninstall + 1 start/stop)

- [ ] **Step 5: Commit**

```bash
git add src/backend/codex.ts src/backend/codex.test.ts src/backend/index.ts
git commit -m "feat(codex): add CodexBackend class and factory wiring"
```

---

## Task 7: Accept 'codex' in backend validator

**Files:**
- Modify: `src/backend/config-resolver.ts`
- Modify: `src/backend/config-resolver.test.ts`

- [ ] **Step 1: Add test case**

Edit `src/backend/config-resolver.test.ts` — add an `it` block inside the `validateBackendType` describe:

```typescript
it('accepts codex', () => {
  assert.equal(validateBackendType('codex'), 'codex');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build && node --test dist/backend/config-resolver.test.js`
Expected: `fail 1` on the new "accepts codex" test (throws "Unknown backend type: codex")

- [ ] **Step 3: Update the validator**

Edit `src/backend/config-resolver.ts` — update the check:

```typescript
export function validateBackendType(type: string): BackendType {
  if (type !== 'openclaw' && type !== 'hermes' && type !== 'claude-code' && type !== 'codex') {
    throw new Error(`Unknown backend type: ${type}. Valid values: openclaw, hermes, claude-code, codex`);
  }
  return type as BackendType;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build && node --test dist/backend/config-resolver.test.js`
Expected: `pass 5  fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/backend/config-resolver.ts src/backend/config-resolver.test.ts
git commit -m "feat(codex): accept codex in validateBackendType"
```

---

## Task 8: Global uninstall integration

**Files:**
- Modify: `src/installer/uninstall.ts`

- [ ] **Step 1: Add Codex cleanup to uninstallAllWorkflows**

Edit `src/installer/uninstall.ts` — update imports:

```typescript
import { uninstallAntfarmSkill, uninstallAntfarmSkillForHermes, uninstallAntfarmSkillForClaudeCode, uninstallAntfarmSkillForCodex } from "./skill-install.js";
import { CodexBackend } from "../backend/codex.js";
```

Then add a Codex cleanup block after the Claude Code cleanup in `uninstallAllWorkflows` (look for the line `await uninstallAntfarmSkillForClaudeCode(process.cwd());` — insert after it):

```typescript
  // Codex backend cleanup: for each installed workflow, remove overlay TOMLs
  // and config.toml entries. Then remove the antfarm-workflows skill from
  // ~/.codex/skills/ once no workflows remain.
  const codex = new CodexBackend();
  for (const wfId of installedWorkflowIds) {
    try {
      await codex.uninstall(wfId);
    } catch (err) {
      console.warn(`Failed to uninstall Codex artifacts for workflow "${wfId}":`, err);
    }
  }
  await uninstallAntfarmSkillForCodex();
```

- [ ] **Step 2: Verify tsc compiles**

Run: `node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add src/installer/uninstall.ts
git commit -m "feat(codex): wire Codex cleanup into uninstallAllWorkflows"
```

---

## Task 9: CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Codex section before "Known limitations / won't-fix"**

Edit `CLAUDE.md` — insert a new top-level section after the Claude Code backend section:

```markdown
## Codex Backend (phase 1: install/uninstall only)

The Codex backend writes workflow configuration to the user's **global** `~/.codex/` directory (same ergonomic choice as Hermes — Codex is designed around per-user state, not per-project). Artifacts:

- `~/.codex/agents/antfarm-<workflowId>-<agentId>.toml` — role overlay per workflow agent. Contains `model`, `sandbox_mode` (from role mapping), `model_reasoning_effort`, and `developer_instructions` (role-specific guardrail). Referenced by both the profile and agent_role entries in config.toml.
- `~/.codex/config.toml` antfarm-managed block — bounded by `# BEGIN antfarm-managed` / `# END antfarm-managed` comments at end of file. Contains `[profiles."antfarm-<wf>-<agent>"]` for scheduler-driven autonomous runs AND `[agent_roles."antfarm-<wf>-<agent>"]` for user-triggered interactive `spawn()` calls from Codex main agent.
- `~/.codex/skills/antfarm-workflows/SKILL.md` — main-agent entry point (parallels Hermes skill install).

**Permission model:** OS-level sandbox via `sandbox_mode` in the role overlay. Three values: `read-only`, `workspace-write`, `danger-full-access`. Enforced at syscall level — `read-only` blocks even `printf > file` or `tee` Bash tricks. Stronger than Hermes (toolset-only) and coarser than Claude Code (per-tool). Role → sandbox mapping in `src/backend/codex-policy.ts`.

**config.toml management:** No TOML parser dependency. The antfarm-managed block at file end is identified by marker comments. Install rewrites the block in place; uninstall filters entries by `antfarm-<workflowId>-` prefix. User's hand-edited sections (outside the block) are never touched.

**`startRun` / `stopRun` are intentional no-ops** — shared scheduler is a follow-up with Claude Code. Interactively, users can already invoke workflow agents via Codex main agent's `spawn(message=..., agent_type="antfarm-<wf>-<agent>")`.

**Canonical spawn (scheduler, phase 2):**

```bash
codex exec \
  --json --ephemeral --skip-git-repo-check \
  --cd <workspace-dir> \
  --profile antfarm-<workflowId>-<agentId> \
  --output-last-message /tmp/antfarm-<run-id>.txt \
  -- "<polling prompt>"
```

Profile supplies model / sandbox / reasoning / prompt — scheduler just passes workspace + prompt + output path.

**PoC-validated gotchas:**
- `-a/--ask-for-approval` is **only on top-level `codex` command**, NOT on `codex exec`. Don't pass it.
- `--skip-git-repo-check` is required unless the target dir is a git repo.
- `read-only` sandbox also blocks `/tmp` writes — use `--add-dir` to open specific paths.
- `-c key=value` values are TOML-parsed (use `-c model="o3"` with quotes around string values).
```

- [ ] **Step 2: Verify placement**

Run: `grep -n "^## " CLAUDE.md`
Expected: Codex section appears between "Claude Code Backend" and "Known limitations / won't-fix".

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(codex): document phase-1 backend behavior and CLI gotchas"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full build + all new tests**

Run: `/Users/winter/.nvm/versions/node/v22.20.0/bin/npm run build && node --test \
  dist/backend/codex-policy.test.js \
  dist/backend/codex-spawn.test.js \
  dist/backend/codex-config.test.js \
  dist/backend/codex.test.js \
  dist/backend/config-resolver.test.js \
  dist/installer/skill-install.test.js`

Expected: all tests pass, zero failures.

- [ ] **Step 2: Full backend test suite (regression check)**

Run: `find dist/backend -name '*.test.js' | xargs node --test`
Expected: no new failures vs. baseline (pre-existing stopWorkflow failure in installer tests is not our concern).

- [ ] **Step 3: Type check**

Run: `node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: zero output (zero errors).

- [ ] **Step 4: Git log review**

Run: `git log --oneline main..HEAD`
Expected: ~9 commits with `feat(codex):` / `docs(codex):` prefixes.

---

## Commits (expected, in order)

```
feat(codex): extend BackendType union with codex
feat(codex): add role → sandbox mode + developer_instructions policy
feat(codex): add buildCodexExecArgv flag composer
feat(codex): add marker-block config.toml manager + role overlay writer
feat(codex): install antfarm-workflows skill into ~/.codex/skills/
feat(codex): add CodexBackend class and factory wiring
feat(codex): accept codex in validateBackendType
feat(codex): wire Codex cleanup into uninstallAllWorkflows
docs(codex): document phase-1 backend behavior and CLI gotchas
```

---

## Follow-up plan (NOT in scope)

1. **Subprocess execution:** `child_process.spawn('codex', argv)` with JSONL event parsing (thread.started / turn.started / item.completed / turn.completed).
2. **Shared scheduler:** `SubprocessBackend` abstraction — Codex and Claude Code both implement `buildSpawnArgv()`; scheduler iterates pending steps and spawns via subclass hook.
3. **`antfarm workflow tick <agent>`:** one-shot manual invocation for both backends.
4. **Worktree handling:** Codex has no `--worktree`; antfarm creates per-agent worktrees if requested (share with Claude Code's worktree logic, which uses `--worktree` flag).
5. **MCP server alternative:** expose antfarm step ops as an MCP server (`codex mcp add antfarm -- node <cli> mcp-serve`) to skip the Bash subprocess chain.
6. **Cost telemetry:** extract `usage.input_tokens`/`output_tokens` from each spawn's JSONL stream; compute $ via model rate table.
