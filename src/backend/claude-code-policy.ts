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
