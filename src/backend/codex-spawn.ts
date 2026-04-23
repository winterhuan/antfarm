import { spawn } from 'node:child_process';

export interface CodexExecSpawnOptions {
  profileName: string;
  workspaceDir: string;
  prompt: string;
  lastMessagePath: string;
  addDirs?: string[];
}

export interface CodexProcessSpawnOptions {
  workspace: string;
  profile: string;
  prompt: string;
  addDirs?: string[];
}

export interface CodexProcessSpawnResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
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

/**
 * Spawn a Codex process for interactive execution.
 * Returns the process result including stdout, stderr, and exit code.
 */
export async function spawnCodexProcess(opts: CodexProcessSpawnOptions): Promise<CodexProcessSpawnResult> {
  const argv: string[] = [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--cd', opts.workspace,
    '--profile', opts.profile,
  ];

  for (const dir of opts.addDirs ?? []) {
    argv.push('--add-dir', dir);
  }

  argv.push('--', opts.prompt);

  return new Promise((resolve) => {
    const proc = spawn('codex', argv, {
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
