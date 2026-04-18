# Claude Code Backend Integration - Design Spec

> **Date:** 2026-04-18
> **Status:** Designed (PoC validated, implementation pending)
> **Related:** Follows Hermes Backend (`2026-04-17-hermes-backend-design.md`)

---

## Overview

Add Claude Code as a third antfarm backend alongside OpenClaw and Hermes. Each backend implements the same `Backend` interface (`install` / `uninstall` / `startRun` / `stopRun`) but differs in execution model. Claude Code is fundamentally interactive — no built-in daemon, no profile system — so the backend works by spawning `claude -p` subprocesses driven by a local scheduler (own daemon or reusing OpenClaw Gateway's cron loop).

**Key advantage over Hermes:** Claude Code supports flag-level per-tool deny (`--disallowedTools`), so OpenClaw-style `ROLE_POLICIES` can be enforced as **hard** restrictions, not just soft prompt guardrails.

## PoC Validation Summary

A scratch end-to-end spike under `/tmp/antfarm-cc-spike/` confirmed the architecture is viable.

### What was proven

| Capability | Result |
|---|---|
| `claude -p --output-format stream-json` non-interactive | ✅ Works, JSON-per-line output |
| End-to-end: spawn → Bash → fake-CLI step claim → Read → Bash → fake-CLI step complete | ✅ 4 turns, 24s, $0.064 |
| `--disallowedTools "Write,Edit,MultiEdit,NotebookEdit"` enforcement | ✅ Hard-blocked; Claude tried 3 workarounds (`printf >`, `tee`, `cd + relative`), all refused |
| `permission_denials[]` in JSON output | ✅ Structured: `tool_name`, `tool_use_id`, `tool_input`, description |
| Stream events parseable (system/assistant/user/result) | ✅ Each event one line, scheduler can consume incrementally |

### Critical gotchas

1. **`--permission-mode bypassPermissions` is REQUIRED.** With the default permission mode, every Bash call returns "This command requires approval" and `-p` non-interactive sessions auto-fail. Without this flag, the entire backend doesn't work.
2. **`--disallowedTools` value must be comma-separated** (`"Write,Edit,MultiEdit"`), not space-separated. Variadic `<tools...>` flag parsing eats the prompt argument otherwise. Always pass `--` before the prompt as belt-and-suspenders.
3. **`--max-budget-usd` is post-hoc, not pre-check.** Test cap of $0.05 actually charged $0.145 before stopping. Treat as a circuit breaker, not a precise limit.

### Cost data (PoC actuals)

| Configuration | Cost / turn | Notes |
|---|---|---|
| Opus-4.7-1M, default flags | $0.145 | Baseline (23K cache creation tokens) |
| Opus-4.7-1M, `--bare` | $0.064 | `--bare` skips CLAUDE.md / hooks / plugin sync |
| Sonnet, `--bare` | unverified | Provider 1M-context policy blocked test on PoC machine |

### Total spike cost

$0.39 across 5 invocations (initial sanity, role-permission test, two failed end-to-end attempts, one successful end-to-end).

## Architecture Decision

Three execution models were considered. Path C is chosen.

### Path A — Anthropic-hosted scheduled agents (RemoteTrigger / `schedule` skill)

Status: **Rejected.** Scheduled remote agents run in Anthropic's managed environment with no access to the user's local filesystem. Antfarm state lives in `~/.openclaw/antfarm/*.db`; remote agents can't read or write it.

### Path B — Pure interactive (subagents only, no scheduler)

Status: **Rejected.** Loses antfarm's autonomy property. Workflows would only advance when the user is actively chatting with Claude Code. Acceptable only if antfarm pivots from "self-driving pipeline" to "structured prompt template."

### Path C — Local scheduler + `claude -p` subprocess spawn (CHOSEN)

A small local daemon polls SQLite on a 5-minute tick (matching OpenClaw / Hermes cadence). Each tick that finds work spawns `claude -p` with role-specific tool permissions, a polling-style prompt, and structured JSON output. The spawned process invokes the antfarm CLI via Bash to claim/complete steps — same SQLite state as OpenClaw/Hermes.

### Path D — Hooks-triggered (SessionStart hook)

Status: **Documented but not chosen.** Could supplement Path C: when the user opens any Claude Code session, a SessionStart hook checks for pending work. Useful as opportunistic acceleration but cannot replace the scheduler.

## Architecture

### Spawn invocation (canonical form)

```bash
claude -p \
  --bare \
  --no-session-persistence \
  --output-format stream-json --verbose \
  --permission-mode bypassPermissions \
  --disallowedTools "<role-specific deny list>" \
  --worktree "<workflowId>_<agentId>" \
  --max-budget-usd <budget> \
  --session-id <uuid> \
  --model <sonnet|opus|haiku> \
  -- "<polling prompt>"
```

### Backend implementation outline

```typescript
export class ClaudeCodeBackend implements Backend {
  async install(workflow, sourceDir): Promise<void> {
    // 1. Write antfarm-workflows skill to .claude/skills/ (parity with OpenClaw/Hermes)
    // 2. For each agent: write subagent definition to .claude/agents/<wf>_<agent>.md
    //    (compatible with interactive use)
    // 3. Update .claude/settings.json with permissions.allow/deny per agent role
    //    (settings-level mirror of CLI --disallowedTools)
    // 4. Register cron-equivalent polling job with our scheduler
  }

  async uninstall(workflowId): Promise<void> {
    // 1. Remove subagent files matching <workflowId>_*
    // 2. Remove permission entries from .claude/settings.json
    // 3. Cancel polling jobs
  }

  async startRun(workflow): Promise<void> { /* enable polling jobs */ }
  async stopRun(workflow): Promise<void>  { /* disable polling jobs */ }
}
```

### Role policy mapping

OpenClaw's `ROLE_POLICIES` maps directly to `--disallowedTools` strings:

```typescript
const ROLE_DISALLOWED_TOOLS: Record<AgentRole, string> = {
  analysis:     "Write,Edit,MultiEdit,NotebookEdit",
  coding:       "",  // no restrictions
  verification: "Write,Edit,MultiEdit,NotebookEdit",
  testing:      "Write,Edit,MultiEdit",  // tests may need NotebookEdit
  pr:           "Write,Edit,MultiEdit,NotebookEdit",
  scanning:     "Write,Edit,MultiEdit,NotebookEdit",
};
```

Plus `ALWAYS_DENY` equivalents: `mcp__*` tools the workflow shouldn't touch, etc. Specific list TBD during implementation.

## Key Design Decisions

### 1. Reuse antfarm CLI for state operations

Spawned `claude -p` sessions use Bash to invoke `node <antfarm-cli> step claim/complete/fail` — identical to OpenClaw/Hermes. No SQLite client embedded in the prompt, no MCP server needed. Keeps state ops centralized and the spawn lightweight.

### 2. `--permission-mode bypassPermissions` + `--disallowedTools` is the security model

The bypass mode disables interactive prompting (mandatory for non-interactive). The `--disallowedTools` list is the **only** permission boundary. Verified by PoC: Claude actively tried multiple workarounds against deny rules and all were blocked, including indirect attempts via Bash output redirection.

### 3. Per-spawn cost cap via `--max-budget-usd`

Each spawn gets a budget cap derived from agent role: cheap for analysis/scanning, higher for coding. Combined with model selection (sonnet for polling, opus for coding heavy lifting). Cap is post-hoc — provides safety, not precision.

### 4. Git worktree isolation via `--worktree`

Claude Code natively creates a git worktree per session via the `--worktree <name>` flag. We use this for workflow agent isolation instead of building our own worktree management. Worktree name follows `${workflowId}_${agentId}` convention.

### 5. Subagent definitions for interactive parity

Even though autonomous execution doesn't need them, write `.claude/agents/<wf>_<agent>.md` files so users can invoke workflow agents interactively via Claude Code's Agent tool when debugging.

### 6. Scheduler: TBD between options

Two valid paths, decision deferred to implementation:

- **Option a:** Reuse OpenClaw Gateway's cron mechanism if Gateway is already running (one daemon for both backends). Cheaper to operate but couples Claude Code backend to OpenClaw availability.
- **Option b:** Standalone `antfarm-cc-runner` daemon, launched via launchd / systemd / nohup. Independent but requires its own lifecycle management.

Recommend (a) if OpenClaw Gateway can spawn arbitrary subprocesses; (b) otherwise.

## Configuration

Existing backend selection hierarchy applies:

1. CLI: `--backend claude-code`
2. Agent: `agent.backend: claude-code`
3. Workflow: `defaultBackend: claude-code`
4. Global: `~/.config/antfarm/config.yaml`
5. Default: `openclaw`

New `BackendType` value: `'claude-code'`.

## Files To Be Created

```
src/backend/claude-code.ts             # Backend implementation
src/backend/claude-code-policy.ts      # ROLE_POLICIES → --disallowedTools mapping
src/backend/claude-code-spawn.ts       # claude -p subprocess invocation + stream-json parsing
src/backend/claude-code-scheduler.ts   # Cron loop OR adapter to OpenClaw Gateway
src/installer/skill-install.ts         # Add installAntfarmSkillForClaudeCode() helper
tests/backend/claude-code.test.ts      # Mock-based unit tests
```

## Files To Be Modified

```
src/backend/interface.ts               # Add 'claude-code' to BackendType
src/backend/index.ts                   # Wire ClaudeCodeBackend into createBackend()
src/installer/uninstall.ts             # Add Claude Code cleanup to uninstallAllWorkflows()
CLAUDE.md                              # Add Claude Code backend section
```

## Open Questions

1. **Sonnet model access on PoC machine.** The 1M-context provider policy blocked `--model sonnet` validation. Need to verify in a normal-tier account that `claude -p --model sonnet --bare` runs correctly and at expected lower cost (Sonnet is ~5× cheaper than Opus per token).
2. **Scheduler choice (a vs b above).** Implementation should decide based on OpenClaw Gateway's spawn-subprocess capability.
3. **`.claude/settings.json` merge strategy.** If the user has existing `permissions` config, antfarm needs to merge rather than overwrite. Same pattern as OpenClaw's main-agent guidance upsert blocks.
4. **Worktree cleanup.** `--worktree` creates worktrees but doesn't auto-clean. Need an `uninstall` strategy for stale worktrees from removed workflows.
5. **Agent ID validation.** Same path-traversal risk as Hermes — agent IDs flow into worktree names and file paths. Reuse `assertSafeProfilePath`-style guard.

## Testing Strategy

- **Unit tests:** Mock `child_process.spawn` for `claude -p`, assert flag composition (especially `--disallowedTools` formatting), parse fixture stream-json events.
- **Integration test (manual / opt-in):** Real `claude -p` invocation against a fake-antfarm CLI in a tmp dir; verify end-to-end. Cost-gate behind an env var so CI doesn't burn API credit.
- **Cost regression check:** Snapshot expected per-turn cost for each role; alert if a future change pushes it over threshold.

## Risks

| Risk | Mitigation |
|---|---|
| Per-spawn cost in production scales linearly with agents × ticks | `--bare` + sonnet for polling phase + `--max-budget-usd` cap |
| `--permission-mode bypassPermissions` is broad-strokes | `--disallowedTools` is the real guardrail; verified hard-blocks in PoC |
| Claude Code CLI flag schema may shift between versions | Pin `claude --version` check in `install`; warn on mismatch |
| Stream-json parser fragility | Use existing JSON-line parsers; isolated in `claude-code-spawn.ts` |
| Auth: `--bare` requires `ANTHROPIC_API_KEY` env var, not OAuth | Document setup; consider falling back to non-`--bare` if no API key |

## Backward Compatibility

- Existing OpenClaw and Hermes backends untouched
- New `'claude-code'` value added to `BackendType` union
- Default backend remains `openclaw`
- No changes to workflow YAML schema beyond using existing `backend: claude-code` field

## Future Considerations

- **MCP server alternative:** Wrap antfarm step ops as an MCP server instead of CLI invocations. Would let Claude Code call `step claim` as a native tool rather than via Bash. Defer until CLI approach proves limiting.
- **Hooks-triggered acceleration (Path D):** Add a SessionStart hook that opportunistically advances pending steps when user opens Claude Code. Requires Path C to be working first.
- **Cost dashboard:** Aggregate `total_cost_usd` from each spawn's JSON output into a per-workflow / per-run cost view. Useful for tuning model selection.

---

## Self-review notes

This is a **design spec**, not an implementation plan. It captures architecture decisions and PoC findings to inform a follow-up plan. The user invoked the writing-plans skill but asked for a spec/design doc; this matches the existing `docs/superpowers/specs/` precedent (Hermes design spec at the same level).

A separate task-by-task implementation plan should be written next via the same skill, saved to `docs/superpowers/plans/2026-04-18-claude-code-backend-plan.md`.
