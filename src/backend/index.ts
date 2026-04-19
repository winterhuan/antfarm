import type { Backend, BackendType } from './interface.js';
import { OpenClawBackend } from './openclaw.js';
import { HermesBackend } from './hermes.js';
import { ClaudeCodeBackend } from './claude-code.js';

export function createBackend(type: BackendType): Backend {
  switch (type) {
    case 'openclaw':
      return new OpenClawBackend();
    case 'hermes':
      return new HermesBackend();
    case 'claude-code':
      return new ClaudeCodeBackend();
    case 'codex':
      throw new Error("CodexBackend not yet implemented — pending task 6");
    default:
      throw new Error(`Unknown backend type: ${type}`);
  }
}

export { groupAgentsByBackend } from './group-agents.js';
export type { Backend, BackendType } from './interface.js';
export { resolveBackendConfig, validateBackendType } from './config-resolver.js';
export type { BackendConfig, ResolvedBackendConfig } from './config-resolver.js';
