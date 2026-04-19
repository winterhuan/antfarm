# Codex Backend Integration - Design Spec

> **Date:** 2026-04-19
> **Status:** Designed (PoC validated, implementation pending)
> **Related:** Follows Hermes (`2026-04-17-hermes-backend-design.md`) and Claude Code (`2026-04-18-claude-code-backend-design.md`)

---

## Overview

Add OpenAI's Codex CLI (`codex-cli` 0.104+) as a fourth antfarm backend. Each backend implements the same `Backend` interface (`install` / `uninstall` / `startRun` / `stopRun`). Codex differs from both prior interactive-CLI backends:

- Unlike Claude Code (which has a markdown-based subagent system), **Codex has a native multi-agent system** (`multi_agents_v2` tool set — `spawn`/`close_agent`/`list_agents`/`send_message`/`followup_task`/`wait`) backed by `[agent_roles.<name>]` TOML entries with full Config overlay. This is richer than Claude Code's subagents — roles can override model, sandbox, reasoning effort, timeout, and prompt, all in one TOML file.
- Unlike Hermes (toolset-level enable/disable), **Codex enforces permissions via OS-level sandbox** (macOS seatbelt / Linux landlock): `read-only` / `workspace-write` / `danger-full-access`. Syscall-level — blocks writes even from Bash `>` redirection or `tee`. Stronger guarantee than Hermes, coarser grain than Claude Code's per-tool deny.

**This is phase 1** — install/uninstall primitives + role registration. Actual `codex exec` subprocess spawning and the cron-polling scheduler are a follow-up plan (will share infrastructure with Claude Code's equivalent follow-up).

## PoC Validation Summary

Scratch spikes under `/tmp/antfarm-codex-spike/` confirmed viability. All key primitives work.

### What was proven

| Capability | Result |
|---|---|
| `codex exec --json --ephemeral` non-interactive mode | ✅ Returns clean JSONL event stream (thread/turn/item.completed/turn.completed) |
| End-to-end: spawn → Bash (fake-antfarm step claim) → Read → Bash (step complete) | ✅ 13 events, 3 command_execution items, all exit 0 |
| `-s read-only` sandbox enforcement | ✅ **syscall-level block**; agent tried workarounds, all refused with "Operation not permitted" |
| Sandbox self-diagnosis | ✅ Codex agent explicitly recognizes "this session is running in a read-only sandbox" and reports clearly |
| `--output-last-message <file>` extraction | ✅ Cleanly writes final agent message for scheduler consumption |
| `--add-dir` for extra writable dirs | ✅ Verified workspace-write sandbox permits writes only within `--cd` + `--add-dir` paths |
| Multi-agent system discovery | ✅ `spawn` tool with `agent_type=<role>` resolves via `apply_role_to_config` + loads TOML overlay |
| `[agent_roles.<name>]` schema | ✅ Three fields: `description`, `config_file` (path to overlay TOML), `nickname_candidates` (optional array) |
| Built-in role example (`awaiter.toml`) | ✅ Sample shows `developer_instructions` + `model_reasoning_effort` + `background_terminal_max_timeout` |

### Critical gotchas

1. **`-a/--ask-for-approval` is NOT on `codex exec`.** It's only on the top-level `codex` command (interactive mode). `codex exec` implicitly uses `never` or similar. Don't pass `-a` with `exec`.
2. **`--skip-git-repo-check` is required** unless the target dir is already a git repo. Codex defaults to refusing to run outside a git repo.
3. **`-c key=value` uses TOML-parsed values.** E.g., `-c model="o3"` — the value is parsed as TOML literal (so strings need quotes if they'd otherwise be ambiguous).
4. **OS sandbox only enforces within a git repo workspace + `--add-dir` paths.** On macOS, `/tmp` is NOT automatically writable in `read-only` mode — any write outside the workspace is blocked.

### Token costs (PoC actuals, gpt-5.3-codex on custom proxy)

| Spike | Tokens in | Cached | Tokens out |
|---|---|---|---|
| Minimal `2+2` exec | 8,330 | 2,560 | 74 |
| Sandbox enforcement test | 26,301 | 8,576 | 683 |
| Full claim→work→complete | 36,686 | 14,080 | 912 |

No exact dollar costs surfaced in JSON output (Codex's JSON has `usage` but no `total_cost_usd` — antfarm will compute from token counts if needed). Cache-hit rates favorable (30-40%) once session warms.

## Architecture Decision

Three execution models considered. **Path Z (profiles + agent_roles combined) is chosen.**

### Path X — Codex profiles only

Install adds one `[profiles.antfarm-<wf>-<agent>]` section per workflow agent. Scheduler calls `codex exec --profile antfarm-<wf>-<agent>`. Simple and minimal.

**Downside:** Codex main agent (TUI, interactive) can't spawn workflow agents via its native `spawn` tool — the profile system isn't integrated with the subagent tool. User loses interactive parity.

### Path Y — Codex agent_roles only

Install adds `[agent_roles.antfarm-<wf>-<agent>]`. Scheduler calls `codex exec ...` on a top-level agent whose sole prompt is "spawn subagent with `agent_type=antfarm-<wf>-<agent>` and forward the task." Two-layer spawn ceremony every cron tick.

**Downside:** doubles token cost per tick (parent agent + child agent). Unnecessary ceremony for autonomous path.

### Path Z — Both (CHOSEN)

Install writes BOTH `[profiles.antfarm-<wf>-<agent>]` and `[agent_roles.antfarm-<wf>-<agent>]` — they share the same underlying role TOML overlay file at `~/.codex/agents/antfarm-<wf>-<agent>.toml`.

- **Scheduler path (autonomous):** `codex exec --profile antfarm-<wf>-<agent>` — one-layer spawn, profile gives us sandbox_mode + model + reasoning + prompt.
- **Interactive path (user TUI):** User chats with Codex main agent; when they ask to run a workflow step, main agent calls `spawn(message=..., agent_type="antfarm-<wf>-<agent>")` which resolves the same overlay TOML via the role layer. Native Codex multi-agent UX.

This mirrors the Claude Code backend's strategy (subagent files for interactive + `--agent`/`--disallowedTools` flags for scheduler). Symmetry makes the phase-2 scheduler refactor cleaner.

## Architecture

### Role TOML overlay (per-workflow-agent)

Single file at `~/.codex/agents/antfarm-<wf>-<agent>.toml`. Shared between the profile and the agent_role entries:

```toml
# Managed by antfarm — do not edit directly.
# Overwritten on `antfarm workflow install`.

model = "gpt-5.3-codex"
sandbox_mode = "read-only"             # ← per-role mapping from AgentRole
model_reasoning_effort = "high"

developer_instructions = """You are the antfarm <workflowId>/<agentId> agent (role: verification).

...role-specific guardrail text from ROLE_GUARDRAILS injected here...
"""
```

### config.toml entries (per-workflow-agent)

All antfarm-managed sections live between marker comments at the end of `~/.codex/config.toml`. Uninstall removes the whole block deterministically without needing a TOML parser.

```toml
# ... user's own config.toml content ...

# BEGIN antfarm-managed
# workflow-id = feature-dev
[profiles."antfarm-feature-dev-verifier"]
model = "gpt-5.3-codex"
sandbox_mode = "read-only"
model_reasoning_effort = "high"

[agent_roles."antfarm-feature-dev-verifier"]
description = "antfarm feature-dev/verifier: read-only validation"
config_file = "~/.codex/agents/antfarm-feature-dev-verifier.toml"

# ... more profile + role pairs for other agents ...
# END antfarm-managed
```

Why marker-delimited block instead of a TOML parser:
- Zero new dependencies (current antfarm ships only `json5` + `yaml`)
- TOML table sections are order-independent — appending at file end is valid TOML
- Install/uninstall is a pure line-rewrite operation
- Coexists with user's hand-edited config cleanly

### Spawn invocation (canonical form for scheduler)

```bash
codex exec \
  --json \
  --ephemeral \
  --skip-git-repo-check \
  --cd <workspace-dir> \
  --add-dir <extra-writable-dirs> \
  --profile antfarm-<workflowId>-<agentId> \
  --output-last-message /tmp/antfarm-codex-<run-id>.txt \
  -- "<polling prompt>"
```

Notes:
- No `-m/--model` — profile supplies it
- No `-s/--sandbox` — profile supplies it
- No `-a` — `exec` mode is inherently non-interactive
- `--json` emits JSONL events (one per line) to stdout; scheduler parses incrementally
- `--output-last-message` writes the final agent text to a file for cheap extraction (no need to find the last agent_message in the stream)

### Backend implementation outline

```typescript
export class CodexBackend implements Backend {
  constructor(private readonly codexHome: string = path.join(os.homedir(), '.codex')) {}

  async install(workflow, sourceDir): Promise<void> {
    // 1. Install antfarm-workflows skill to ~/.codex/skills/ (global, like Hermes)
    // 2. For each agent:
    //    a. Write ~/.codex/agents/antfarm-<wf>-<agent>.toml (role overlay)
    // 3. Rewrite the antfarm-managed block in ~/.codex/config.toml with [profiles.*] and [agent_roles.*]
  }

  async uninstall(workflowId): Promise<void> {
    // 1. Remove the antfarm-managed block for this workflow from ~/.codex/config.toml
    //    (multi-workflow case: only strip entries with `antfarm-<workflowId>-*` names)
    // 2. Delete ~/.codex/agents/antfarm-<workflowId>-*.toml
    // 3. If no more antfarm-managed workflows remain, uninstall the skill
  }

  async startRun(_workflow): Promise<void> { /* no-op in phase 1 */ }
  async stopRun(_workflow): Promise<void>  { /* no-op in phase 1 */ }
}
```

### Role → Codex sandbox mapping

```typescript
import type { SandboxMode } from './codex-types.js';

const ROLE_SANDBOX: Record<AgentRole, SandboxMode> = {
  analysis:     'read-only',       // read + trusted exec, no writes
  coding:       'workspace-write', // full dev access within workspace
  verification: 'read-only',       // run lint/typecheck/tests, but no fixes
  testing:      'workspace-write', // tests may produce artifacts
  pr:           'read-only',       // git/gh on already-committed changes
  scanning:     'read-only',       // static analysis + web lookups
};
```

Mapping is semantically tighter than Claude Code's `--disallowedTools` list: `read-only` mode blocks ALL writes at syscall level, including sneaky `printf > file`, `tee`, `curl -o`, etc. Claude Code's deny list catches the Write/Edit/MultiEdit tools plus sandbox-blocks redirection, but the protection is per-tool-name; Codex's is per-syscall.

## Key Design Decisions

### 1. Marker-delimited config.toml block (no TOML parser dependency)

Antfarm section bounded by `# BEGIN antfarm-managed` / `# END antfarm-managed` comments at file end. Install rewrites the entire block; uninstall removes it or strips workflow-specific entries. No new dep.

### 2. Per-role TOML overlay file at `~/.codex/agents/`

One file per `<workflowId>_<agentId>` pair, referenced by both the profile and the agent_role. Source of truth for role-specific config. Located globally in `~/.codex/agents/` (Codex's convention), NOT per-project — because Codex is designed around per-user state, unlike Claude Code which is per-project.

### 3. Antfarm-managed prefix naming

All antfarm profiles and roles use the prefix `antfarm-<workflowId>-<agentId>`. This:
- Namespaces away from user-defined profiles/roles (collision avoidance)
- Lets uninstall filter entries for a specific workflow via prefix match
- Mirrors how `HermesBackend` uses `<workflowId>_<agentId>` for profile names

### 4. Skill install parallels Claude Code/Hermes

Global skill at `~/.codex/skills/antfarm-workflows/SKILL.md`. Template substitution (`{{antfarmCli}}` / `{{forceTriggerSection}}`) via existing `writeAntfarmSkill` helper. Idempotent per `installAntfarmSkill*()` precedent.

### 5. startRun / stopRun are no-ops in phase 1

Same decision as Claude Code phase 1. The scheduler is a shared follow-up (`SubprocessScheduler` or reuse OpenClaw Gateway).

### 6. No separate subagent file concept (beyond role overlay)

Codex's `agents/openai.yaml` inside skills is NOT for subagents — it's harness-specific UI metadata. Antfarm doesn't use it. The single role overlay TOML is the full agent definition.

## Configuration

```bash
antfarm workflow install my-workflow --backend codex
antfarm workflow run my-workflow "task description" --backend codex
```

Global config hierarchy unchanged:

1. `--backend codex` CLI flag
2. `agent.backend: codex` in workflow YAML
3. `defaultBackend: codex` in workflow YAML
4. `defaultBackend: codex` in `~/.config/antfarm/config.yaml`
5. Default: `openclaw`

New `BackendType` value: `'codex'`.

## Files To Be Created

```
src/backend/codex.ts                    # CodexBackend class
src/backend/codex.test.ts               # integration tests

src/backend/codex-policy.ts             # AgentRole → SandboxMode + developer_instructions template
src/backend/codex-policy.test.ts        # unit tests (6 roles + undefined fallback)

src/backend/codex-spawn.ts              # buildCodexExecArgv() composer
src/backend/codex-spawn.test.ts         # unit tests (flag order, --profile, --add-dir)

src/backend/codex-config.ts             # config.toml block read/write + role overlay file writer
src/backend/codex-config.test.ts        # marker-block merge tests with tmp fixtures
```

## Files To Be Modified

```
src/backend/interface.ts                # Add 'codex' to BackendType
src/backend/index.ts                    # Wire CodexBackend into createBackend()
src/backend/config-resolver.ts          # validateBackendType accepts 'codex'
src/backend/config-resolver.test.ts     # +1 test for 'codex' accepted

src/installer/skill-install.ts          # Add installAntfarmSkillForCodex() + uninstall counterpart
src/installer/skill-install.test.ts     # +2 tests for Codex skill install

src/installer/uninstall.ts              # Wire Codex cleanup into uninstallAllWorkflows

CLAUDE.md                               # Add Codex backend section
```

## Open Questions

1. **Role overlay TOML syntax details.** The schema for `AgentRoleToml` exposes `description`, `config_file`, `nickname_candidates`. But the referenced overlay file can contain ANY Config field. We'll use: `model`, `sandbox_mode`, `model_reasoning_effort`, `developer_instructions`. Verify during implementation that `sandbox_mode = "read-only"` in the overlay actually takes effect (config layer precedence).
2. **Does `--profile` on `codex exec` apply role overlay's `sandbox_mode`?** Profile and agent_role are two parallel mechanisms. When a session loads `--profile foo`, does it pick up overlay from `[agent_roles.foo]`? Need to verify or accept that profile is separate — in that case profiles and roles just duplicate relevant fields.
3. **Workflow isolation without Codex worktree support.** Codex has no `--worktree` flag. Options: (a) `--cd` to a pre-created dir, (b) antfarm creates git worktrees manually, (c) just use the repo root with role-scoped permissions. Phase 1 uses (a) — scheduler provides the workspace dir.
4. **Handling existing `# BEGIN antfarm-managed` block on install.** Treat as fully replaceable. If user added content between markers, it gets overwritten on next install. Document this in CLAUDE.md.

## Testing Strategy

- **Unit tests:** tmp-dir based for config.toml block manipulation; in-memory for policy + spawn composers.
- **No real `codex exec` calls in CI** — subprocess mocking only. Cost-gated integration test behind `CODEX_SPIKE=1` env var (opt-in).
- **Regression scan:** run full OpenClaw + Hermes + Claude Code test suites to confirm no type-union drift breaks existing backends.

## Risks

| Risk | Mitigation |
|---|---|
| config.toml marker-block gets desynced if user edits inside it | Documented "do not edit" comment in block header; install always rewrites block atomically |
| `sandbox_mode = "read-only"` in overlay doesn't actually apply (profile vs role precedence) | Phase-2 integration test with real `codex exec` verifies; fall back to duplicating `sandbox_mode` in `[profiles.*]` directly |
| Prefix collision (`antfarm-<wf>-<agent>`) with user-defined roles | Extremely unlikely in practice; checked on install — if collision detected, error out |
| Per-spawn cost on gpt-5.3-codex | Inherit Claude Code backend's per-agent model selection (`agent.model`) + `model_reasoning_effort` per role |
| Codex CLI flag schema shifts between versions | Pin `codex --version` check on first install; warn on mismatch with 0.104+ baseline |

## Backward Compatibility

- Existing OpenClaw / Hermes / Claude Code backends untouched
- New `'codex'` added to `BackendType` union
- Default backend remains `openclaw`
- No changes to workflow YAML schema beyond using existing `backend: codex` field

## Future Considerations

- **Scheduler integration** (shared follow-up plan with Claude Code): `SubprocessBackend` abstraction with `buildSpawnArgv()` hook; `CodexBackend` and `ClaudeCodeBackend` implement it.
- **MCP server alternative:** Wrap antfarm step ops as an MCP server (`codex mcp add antfarm -- node <cli> mcp-serve`). Lets Codex invoke `step claim` / `step complete` as native tools rather than via Bash subprocess. Tracked for phase 2.
- **Interactive subagent driving from Codex TUI:** Once agent_roles are registered, user in Codex main agent can say "run the verifier" and main agent's `spawn` tool dispatches. Provides a second UX surface alongside scheduler autonomy.
- **Cost dashboard:** Aggregate `usage.input_tokens`/`output_tokens` from each spawn's JSONL stream into per-workflow token counts; optionally compute $ cost from per-model rate table.

---

## Self-review notes

This is a **design spec**, not an implementation plan. It captures architecture decisions and PoC findings to inform a follow-up plan. The user invoked the writing-plans skill but requested spec+plan; this matches the existing `docs/superpowers/specs/` precedent for Hermes + Claude Code.

Implementation plan is saved separately as `docs/superpowers/plans/2026-04-19-codex-backend-plan.md`.
