# Antfarm — Hermes Backend Notes

Reference for Hermes-related work in this project. Focuses on things that have bitten us or are non-obvious from the code. For general project structure, read the source.

## Hermes Skills

**Location (source of truth):** `$HERMES_HOME/skills/` — defaults to `~/.hermes/skills/`. The **default** profile uses the top-level HERMES_HOME; non-default profiles have their own HERMES_HOME under `~/.hermes/profiles/<name>/`, so their skills dir is `~/.hermes/profiles/<name>/skills/`.

**Drop-in install works.** A folder containing `SKILL.md` placed under the skills dir is auto-discovered — no manifest, no index file, no registration step. It appears in `hermes skills list` and becomes a `/<skill-name>` slash command.

**`hermes skills install <identifier>` does NOT accept local paths.** It only resolves registry IDs (skills.sh, ClawHub, GitHub, taps, well-known endpoints). To install a local/in-repo skill, write the files directly — this is what `installAntfarmSkillForHermes()` in `src/installer/skill-install.ts` does.

**SKILL.md frontmatter — supported fields:**
- `name`, `description`, `version`, `user-invocable`
- `platforms: [macos, linux, windows]` — OS restriction; skill is hidden on mismatching platforms
- `metadata.hermes.tags`, `metadata.hermes.category`
- `metadata.hermes.fallback_for_toolsets` / `requires_toolsets` / `fallback_for_tools` / `requires_tools` — conditional activation based on available tools
- `metadata.hermes.config` — declared config.yaml settings injected at load
- `required_environment_variables` — secrets prompted on first load (CLI only; messaging surfaces never prompt)

**External skill dirs** (`skills.external_dirs` in config.yaml) are scanned read-only alongside the local dir. Useful for shared team dirs.

**`--force` on install** overrides non-dangerous security-scan blocks for community skills. Dangerous verdicts stay blocked regardless.

## Context Files

**Priority order (first match wins, only one loaded per session):**
`.hermes.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules`

**Discovery:** CWD at startup + progressive subdirectory discovery as the agent reads files. Ancestor walk up to 5 parent dirs. Each subdir checked at most once per session.

**Size limit:** 20K chars per file, head/tail truncated (70/20 split). Subdir hints capped at 8K.

**SOUL.md is different.** Loaded ONLY from `$HERMES_HOME/SOUL.md` (never from CWD). It's the agent's identity/persona (slot #1 in system prompt). Each profile has its own SOUL.md via its own HERMES_HOME. Hermes seeds a default SOUL.md on first run; user edits are never overwritten.

**All context files are scanned for prompt injection** before inclusion. Known patterns (override attempts, deception, credential exfiltration, hidden HTML/unicode) are blocked.

## Hermes CLI — gotchas that bit us

Flag positioning and positional args differ across subcommands. These are the ones that caused real bugs:

- **`--profile <name>` goes BEFORE the subcommand:** `hermes --profile foo cron list` (not `hermes cron list --profile foo`).
- **`hermes profile delete`** — name is **positional**, and `--profile` does NOT apply: `hermes profile delete <name> -y`. Early code tried `hermes --profile <name> profile delete --yes` and failed silently.
- **`hermes cron create <schedule> <prompt> --name <name>`** — schedule and prompt are **positional**. There are NO `--every` / `--prompt` flags. Example: `hermes --profile foo cron create 'every 5m' "$PROMPT" --name antfarm/wf/agent`.
- **`hermes cron remove <job_id>`** — takes job_id (positional), NOT name. Look up id first via `cron list` and parse the output (regex `^\s*([a-f0-9]{12})\s+\[` for id line, then `^\s*Name:\s+` for matching name). See `findCronJobId` in `hermes.ts`.
- **`hermes skills install <id> --yes --force`** — `--yes` skips TUI confirmation, `--force` overrides scanner CAUTION verdicts needed for most community skills (e.g. agent-browser from skills-sh).

## Profile Model

- One profile = one isolated Hermes instance with its own HERMES_HOME, config.yaml, skills, SOUL.md, workspace, cron state, sessions.
- Create via clone: `hermes profile create <name> --clone --clone-from default`.
- Each profile has its own `.bundled_manifest`, so `hermes -p <name> skills reset <x>` is profile-scoped.
- Antfarm convention: one profile per workflow agent, naming `${workflowId}_${agentId}` (underscore separator — avoids namespace collision between `foo-bar + baz` and `foo + bar-baz`).

**Clone semantics — empirically verified (2026-04):**
- `hermes profile create <new> --clone --clone-from default` copies `config.yaml`, `.env`, and `SOUL.md` from the source profile.
- It does **NOT** copy user-installed skills from `~/.hermes/skills/`. Instead, it freshly syncs the built-in bundled skills from the Hermes repo (`~/.hermes/hermes-agent/skills/`).
- Concretely: a sentinel skill dropped into `~/.hermes/skills/antfarm-clone-test-sentinel/` did **not** appear in the new profile's `skills/` dir after clone.
- **Implication:** antfarm's `installAntfarmSkillForHermes()` installs to `~/.hermes/skills/`, which means only the default profile gets `/antfarm-workflows`. Per-agent worker profiles (created via clone afterward) stay clean — worker agents don't need that skill anyway (they're driven by the cron prompt).
- Profile delete also removes the symlink wrapper it creates at `~/.local/bin/<profile-name>`.

## Antfarm-specific conventions on Hermes

- **Ownership marker:** antfarm-created profiles have `<profileDir>/.antfarm` containing `{workflowId, version, createdAt}`. `verifyProfileOwnership()` checks this before any destructive op — defense against deleting profiles that happen to share a name prefix.
- **Known marker race:** profile is created via CLI, then `.antfarm` is written separately. Crash between the two leaves an un-markered profile that future installs will reject as "belongs to different workflow." Not fixed yet.
- **Antfarm skill install:** `installAntfarmSkillForHermes()` writes to `$HERMES_HOME/skills/antfarm-workflows/SKILL.md`, using `{{antfarmCli}}` and `{{forceTriggerSection}}` template substitution. Idempotent — overwrites on every workflow install so template changes propagate.
- **`configureProfile` ignores `agent.role`** — no per-role tool restrictions are applied on Hermes. This is a **parity gap we cannot close at the tool-permission layer** — see "Tool permission model: why role parity isn't achievable" below. Soft prompt-level guardrails are applied instead (see `buildRoleGuardrail()` in `agent-cron.ts`).

## Tool permission model: why role parity isn't achievable

OpenClaw's `ROLE_POLICIES` uses a **per-tool deny list** (e.g. verification role gets `deny: ["write", "edit", "apply_patch", ...]`). This is a hard policy — the tool simply isn't available to the agent regardless of what the prompt says.

**Hermes has no equivalent.** Its permission model is:

1. **Toolset-level enable/disable only.** `hermes tools list` shows ~19 toolsets (web, terminal, file, code_execution, …). You can `hermes tools disable <toolset>` but there's no "enable `file` toolset but deny `write_file`". Disabling `file` kills `read_file` too.
2. **Sandboxing via terminal backend.** Hermes recommends `terminal.backend = docker|ssh|singularity` for risky scenarios — the agent runs against an isolated filesystem. This is the docs' own advice. But antfarm workers need to touch the real repo, so sandboxing isn't viable here.
3. **Per-platform toggle.** `--platform cli|telegram|...` exists but is an entry-point filter, not per-profile/per-agent.

What this means in practice:

- We cannot make a Hermes `verifier` agent read-only at the tool level.
- `hermes tools enable/disable` is also per-profile-platform, not per-invocation, so even coarse toolset disable has awkward ergonomics.
- The **soft guardrail** we apply: inject role-specific constraint text near the top of the agent's work prompt (see `ROLE_GUARDRAILS` in `src/installer/agent-cron.ts`). A verifier prompt explicitly tells the model "do not call write_file/patch/edit". This is **instruction-level, not enforced** — a model can ignore it.

Do NOT re-open this investigation assuming we missed a config. We didn't. If Hermes gains per-tool deny-list support upstream, that's the time to revisit.

## Claude Code Backend

The Claude Code backend writes workflow configuration into the **project's** `.claude/` directory (the repo where `antfarm workflow install` is run) rather than a per-agent profile. Artifacts:

- `.claude/agents/<workflowId>_<agentId>.md` — subagent definition per workflow agent. Per-role `disallowedTools` lives in the frontmatter so Claude Code enforces the deny list per-subagent on interactive Task-tool delegation. No global `.claude/settings.json` mutation — a mixed-role workflow would over-restrict coding agents if we unioned denies into the project-wide settings.
- `.claude/skills/antfarm-workflows/SKILL.md` — main-agent entry point for interactive use (parallels OpenClaw / Hermes skill install).
- `<workflowDir>/.claude-project-dir` — install-time marker recording the project dir that owns these artifacts. `uninstallAllWorkflows` (and single-workflow uninstall from a different cwd) reads it to target the correct `.claude/`. Falls back to `process.cwd()` for legacy installs without the marker.

`startRun` / `stopRun` are no-ops. The antfarm **built-in scheduler** (`src/server/subprocess-scheduler.ts`, started by the dashboard daemon) polls the DB for pending steps and spawns `claude -p` subprocesses directly — nothing per-backend to start/stop. Users can also run `antfarm workflow tick <agent-id>` for a one-shot pass.

**Permission model vs Hermes:** Claude Code supports per-tool deny at the CLI flag level (`--disallowedTools "Write,Edit,..."`) and via per-subagent frontmatter. Both are used:
- **Autonomous path** (SubprocessScheduler → `claude -p <prompt>`): CLI flag `--disallowedTools` per-agent (see `claude-code-spawn.ts`). The `claude -p` path does not resolve a named subagent file, so the frontmatter doesn't apply here.
- **Interactive path** (main Claude Code agent → Task tool → antfarm subagent): `.claude/agents/<name>.md` frontmatter `disallowedTools` applies, scoped to that one subagent.

Both are real enforcement — PoC verified that Claude actively attempts workarounds (`printf >`, `tee`, `cd + relative`) and all are blocked.

**Required CLI flags for non-interactive use (from PoC):**
- `--permission-mode bypassPermissions` — MANDATORY. Without this, every Bash call returns "requires approval" and the `-p` session fails silently.
- `--disallowedTools "A,B,C"` — comma-separated; variadic flags eat following args, so always add `--` before the prompt.
- `--bare` — skips CLAUDE.md auto-discovery / hooks / plugin sync for cheaper, context-isolated runs (~$0.06/turn on Opus-4.7-1M vs $0.15 without `--bare`).
- `--max-budget-usd <n>` — post-hoc circuit breaker, not pre-check. Allows ~3× overshoot before tripping.

## Codex Backend

The Codex backend writes workflow configuration to the user's **global** `~/.codex/` directory (same ergonomic choice as Hermes — Codex is designed around per-user state, not per-project). Artifacts:

- `~/.codex/agents/antfarm-<workflowId>-<agentId>.toml` — role overlay per workflow agent. Contains `model`, `sandbox_mode` (from role mapping), `model_reasoning_effort`, and `developer_instructions` (role-specific guardrail). Referenced by both the profile and agent_role entries in config.toml.
- `~/.codex/config.toml` antfarm-managed block — bounded by `# BEGIN antfarm-managed` / `# END antfarm-managed` comments at end of file. Contains `[profiles."antfarm-<wf>-<agent>"]` for scheduler-driven autonomous runs AND `[agent_roles."antfarm-<wf>-<agent>"]` for user-triggered interactive `spawn()` calls from Codex main agent.
- `~/.codex/skills/antfarm-workflows/SKILL.md` — main-agent entry point (parallels Hermes skill install).

**Permission model:** OS-level sandbox via `sandbox_mode` in the role overlay. Three values: `read-only`, `workspace-write`, `danger-full-access`. Enforced at syscall level — `read-only` blocks even `printf > file` or `tee` Bash tricks. Stronger than Hermes (toolset-only) and coarser than Claude Code (per-tool). Role → sandbox mapping in `src/backend/codex-policy.ts`.

**config.toml management:** No TOML parser dependency. The antfarm-managed block at file end is identified by marker comments. Install rewrites the block in place; uninstall filters entries by `antfarm-<workflowId>-` prefix. User's hand-edited sections (outside the block) are never touched.

**`startRun` / `stopRun` are no-ops** — driven by the same built-in SubprocessScheduler as Claude Code (see above). Interactively, users can also invoke workflow agents via Codex main agent's `spawn(message=..., agent_type="antfarm-<wf>-<agent>")`.

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

## Known limitations / won't-fix

These are architectural constraints or low-risk edge cases we've deliberately not addressed. Listed here so they don't get re-investigated.

- **Cron has no `--timeout` flag.** `hermes cron create` / `edit` don't expose a per-job timeout; cron tasks inherit the profile's `terminal.timeout`. We set `timeout.seconds` in `configureProfile` but that applies to interactive chat too — not per-cron. If you need agent-specific cron timeout, upstream Hermes has to add the flag.
- **Cron has no structured output.** `hermes cron list` only emits a human-readable table, so `findCronJobId` regex-parses it. The regex was loosened to accept any hex id ≥6 chars, but Hermes layout changes could still break it.
- **SKILL.md bakes in the current antfarm CLI path.** `installAntfarmSkillForHermes()` substitutes `{{antfarmCli}}` with `resolveAntfarmCli()`'s absolute path at install time. If you move the antfarm install, re-run `workflow install` to refresh the skill.
- **Concurrent `workflow install` is not locked.** Two parallel installs of the same workflow could race on `listAllProfiles` → `hermes profile create`. Create-then-marker is now atomic (marker-failure rolls back), but the profile-exists check isn't locked. Don't install concurrently.
- **`.antfarm` marker has a `version` field but no migration logic.** Current version is `1`. If the schema changes, add a migration pass in `verifyProfileOwnership` that reads and upgrades older versions before the equality check.

## Context References (`@` syntax)

CLI-only feature. Messaging platforms (Telegram/Discord) don't expand `@` — messages pass through. Relevant because Hermes cron jobs running via gateway won't see `@file:` refs in prompts; use `read_file` tool instead.

Supported: `@file:path`, `@file:path:10-25`, `@folder:path`, `@diff`, `@staged`, `@git:5`, `@url:...`. Sensitive paths (~/.ssh/, ~/.aws/, ~/.gnupg/, ~/.kube/, $HERMES_HOME/.env) are always blocked.

## Filesystem Map

```
~/.hermes/
├── config.yaml           # Global config + skills.external_dirs + agent.personalities
├── SOUL.md               # Default profile personality
├── .env                  # Env var secrets (HERMES_HOME/.env, blocked from @file:)
├── skills/               # Default profile skills (source of truth)
│   ├── antfarm-workflows/SKILL.md   # ← installAntfarmSkillForHermes writes here
│   └── .bundled_manifest
├── profiles/<name>/      # Non-default profiles, each a mini HERMES_HOME
│   ├── .antfarm          # ← antfarm ownership marker
│   ├── config.yaml
│   ├── skills/
│   └── workspace/
├── hermes-agent/         # Bundled built-in skills (reference, do not edit)
├── cron/                 # Cron state (per profile)
├── logs/
└── memories/
```

## Docs Reference

Primary sources when in doubt:
- **In-repo mirror:** `.claude/skills/hermes-agent/SKILL.md` — full Hermes agent reference (CLI usage, config, spawning, profiles, contributor notes). Fetched from upstream NousResearch/hermes-agent repo; use as first stop before hitting the docs site.
- Skills: https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
- Context files (AGENTS.md etc.): https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files
- SOUL.md / personality: https://hermes-agent.nousresearch.com/docs/user-guide/features/personality
- `@` context references: https://hermes-agent.nousresearch.com/docs/user-guide/features/context-references
- Tools & toolsets: https://hermes-agent.nousresearch.com/docs/user-guide/features/tools

CLI help is reliable: `hermes <subcmd> --help`. Prefer running that over guessing flag syntax — subcommands have inconsistent positional/flag conventions.
