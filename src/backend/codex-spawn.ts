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
