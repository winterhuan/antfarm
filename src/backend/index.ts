import type { Backend, BackendType } from './interface.js';
import { OpenClawBackend } from './openclaw.js';
import { HermesBackend } from './hermes.js';
import { ClaudeCodeBackend } from './claude-code.js';
import { CodexBackend } from './codex.js';

export function createBackend(type: BackendType): Backend {
  switch (type) {
    case 'openclaw':
      return new OpenClawBackend();
    case 'hermes':
      return new HermesBackend();
    case 'claude-code':
      return new ClaudeCodeBackend();
    case 'codex':
      return new CodexBackend();
    default:
      throw new Error(`Unknown backend type: ${type}`);
  }
}

export { groupAgentsByBackend } from './group-agents.js';
export type { Backend, BackendType, BackendCapabilities, ValidationResult, PermissionAdapter, SpawnResult } from './interface.js';
export { OpenClawBackend } from './openclaw.js';
export { HermesBackend } from './hermes.js';
export { ClaudeCodeBackend } from './claude-code.js';
export { CodexBackend } from './codex.js';
export { resolveBackendConfig, validateBackendType } from './config-resolver.js';
export type { BackendConfig, ResolvedBackendConfig } from './config-resolver.js';
