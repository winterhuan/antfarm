// Step result discriminated by status
export interface StepPending {
  readonly status: 'pending';
  readonly retryCount: number;
  readonly createdAt: string;
}

export interface StepRunning {
  readonly status: 'running';
  readonly claimedAt: string;
  readonly claimedBy: string;
  readonly currentStoryId?: string;
}

export interface StepDone {
  readonly status: 'done';
  readonly output: string;
  readonly completedAt: string;
}

export interface StepFailed {
  readonly status: 'failed';
  readonly output: string;
  readonly failedAt: string;
  readonly retryCount: number;
}

export type StepResultState = StepPending | StepRunning | StepDone | StepFailed;

// Type guards for narrowing
export function isStepPending(result: StepResultState): result is StepPending {
  return result.status === 'pending';
}

export function isStepRunning(result: StepResultState): result is StepRunning {
  return result.status === 'running';
}

export function isStepDone(result: StepResultState): result is StepDone {
  return result.status === 'done';
}

export function isStepFailed(result: StepResultState): result is StepFailed {
  return result.status === 'failed';
}

// Backend config discriminated union
export interface OpenClawConfig {
  readonly type: 'openclaw';
  readonly gatewayUrl: string;
  readonly apiKey: string;
}

export interface HermesConfig {
  readonly type: 'hermes';
  readonly hermesHome: string;
}

export interface ClaudeCodeConfig {
  readonly type: 'claude-code';
  readonly projectDir: string;
}

export interface CodexConfig {
  readonly type: 'codex';
  readonly codexHome: string;
}

export type BackendConfig = OpenClawConfig | HermesConfig | ClaudeCodeConfig | CodexConfig;

// Type guards
export function isOpenClawConfig(config: BackendConfig): config is OpenClawConfig {
  return config.type === 'openclaw';
}

export function isHermesConfig(config: BackendConfig): config is HermesConfig {
  return config.type === 'hermes';
}

export function isClaudeCodeConfig(config: BackendConfig): config is ClaudeCodeConfig {
  return config.type === 'claude-code';
}

export function isCodexConfig(config: BackendConfig): config is CodexConfig {
  return config.type === 'codex';
}
