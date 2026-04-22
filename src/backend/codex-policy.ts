import type { AgentRole } from '../installer/types.js';

/**
 * Codex's three sandbox modes. Syscall-level enforcement (macOS seatbelt /
 * Linux landlock). `read-only` blocks all writes, `workspace-write` allows
 * writes within `--cd` + `--add-dir` paths only.
 */
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * Antfarm's Codex path needs filesystem writes even for review-style roles:
 * step completion updates the run state DB, and some roles also update files
 * under the per-agent workspace. Codex cannot express "repo read-only, state
 * writable", so all roles use `workspace-write` and rely on
 * developer_instructions to forbid repo edits for non-coding roles.
 */
export const ROLE_SANDBOX: Record<AgentRole, CodexSandboxMode> = {
  analysis:     'workspace-write',
  coding:       'workspace-write',
  verification: 'workspace-write',
  testing:      'workspace-write',
  pr:           'workspace-write',
  scanning:     'workspace-write',
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
      'You are in ANALYSIS mode. Antfarm uses workspace-write so you can report step results and update agent-workspace state, but you MUST NOT modify repository files. Read, grep, and search freely. Put proposed changes in your text output — do not apply them.',
    verification:
      'You are in VERIFICATION mode. Antfarm uses workspace-write so you can report step results, but you MUST NOT modify repository files. Run lint/typecheck/tests via shell and report PASS or FAIL.',
    testing:
      'You are in TESTING mode. Antfarm uses workspace-write so you can report step results and update agent-workspace files. Run the existing test suite and report results. You may edit test files or agent-workspace files if the work input explicitly asks for it, but DO NOT modify application source code.',
    pr:
      'You are in PR mode. Antfarm uses workspace-write so you can report step results and run git/gh commands, but you MUST NOT edit source files or tests.',
    scanning:
      'You are in SCANNING mode. Antfarm uses workspace-write so you can report step results, but you MUST NOT modify repository files. Use read_file, grep, search, and web_search to find vulnerabilities. Output findings; do not fix them.',
  };

  return `${header}\n\n${guardrails[role as Exclude<AgentRole, 'coding'>]}`;
}
