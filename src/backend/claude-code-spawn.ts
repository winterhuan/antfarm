import type { AgentRole } from '../installer/types.js';
import { buildDisallowedTools } from './claude-code-policy.js';
import { spawn } from 'node:child_process';

export interface ClaudeCodeSpawnOptions {
  role: AgentRole | undefined;
  prompt: string;
  worktreeName: string;
  sessionId: string;
  maxBudgetUsd: number;
  model: string;
}

export interface ClaudeProcessSpawnOptions {
  workspace: string;
  agentId: string;
  prompt: string;
  disallowedTools?: string;
}

export interface ClaudeProcessSpawnResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
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

/**
 * Spawn a Claude Code process for interactive execution.
 * Returns the process result including stdout, stderr, and exit code.
 */
export async function spawnClaudeProcess(opts: ClaudeProcessSpawnOptions): Promise<ClaudeProcessSpawnResult> {
  const argv: string[] = [
    '-p',
    '--bare',
    '--no-session-persistence',
    '--output-format', 'stream-json',
    '--permission-mode', 'bypassPermissions',
    '--cd', opts.workspace,
  ];

  if (opts.disallowedTools) {
    argv.push('--disallowedTools', opts.disallowedTools);
  }

  argv.push('--', opts.prompt);

  return new Promise((resolve) => {
    const proc = spawn('claude', argv, {
      cwd: opts.workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        exitCode: code ?? undefined,
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        stdout,
        stderr: `${stderr}\nProcess error: ${err.message}`,
        exitCode: -1,
      });
    });
  });
}
