import type { BackendType } from './interface.js';
import type { WorkflowSpec, WorkflowAgent } from '../installer/types.js';
import { readAntfarmConfig, DEFAULT_BACKEND } from '../lib/config.js';

export interface BackendConfig {
  type: BackendType;
}

export interface ResolvedBackendConfig {
  type: BackendType;
  source: 'cli' | 'agent' | 'workflow' | 'global' | 'default';
}

export async function resolveBackendConfig(
  agent: WorkflowAgent,
  workflow: WorkflowSpec,
  cliBackend?: BackendType
): Promise<ResolvedBackendConfig> {
  // Priority 1: CLI argument (highest)
  if (cliBackend) {
    return { type: cliBackend, source: 'cli' };
  }

  // Priority 2: Agent-level configuration
  if (agent.backend) {
    return { type: agent.backend, source: 'agent' };
  }

  // Priority 3: Workflow-level default
  if (workflow.defaultBackend) {
    return { type: workflow.defaultBackend, source: 'workflow' };
  }

  // Priority 4: Global config file (if explicitly set)
  const globalConfig = await readAntfarmConfig();
  if (globalConfig?.defaultBackend) {
    return { type: globalConfig.defaultBackend, source: 'global' };
  }

  // Priority 5: Hardcoded default (lowest)
  return { type: DEFAULT_BACKEND, source: 'default' };
}

export function validateBackendType(type: string): BackendType {
  if (type !== 'openclaw' && type !== 'hermes') {
    throw new Error(`Unknown backend type: ${type}. Valid values: openclaw, hermes`);
  }
  return type as BackendType;
}
