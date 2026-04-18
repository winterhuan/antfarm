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
