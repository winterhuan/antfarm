import type { WorkflowSpec, WorkflowAgent } from '../installer/types.js';

export type BackendType = 'openclaw' | 'hermes' | 'claude-code' | 'codex';

/**
 * Backend capabilities describe what features a backend supports.
 * Used for feature detection and conditional logic.
 */
export interface BackendCapabilities {
  /** Supports per-tool deny lists (OpenClaw, ClaudeCode) */
  supportsPerToolDeny: boolean;
  /** Supports OS-level sandboxing (Codex only) */
  supportsSandbox: boolean;
  /** Uses scheduler-driven execution (ClaudeCode, Codex) */
  schedulerDriven: boolean;
  /** Supports cron management (OpenClaw, Hermes) */
  supportsCronManagement: boolean;
}

/**
 * Result of validating a workflow configuration.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Result of spawning an agent for interactive execution.
 */
export interface SpawnResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
}

/**
 * Permission adapter for applying role-based constraints.
 */
export interface PermissionAdapter {
  /**
   * Apply role constraints to an agent.
   * For OpenClaw/ClaudeCode: tool deny lists
   * For Codex: sandbox mode
   * For Hermes: soft guardrails (prompt injection)
   */
  applyRoleConstraints(agent: WorkflowAgent): Promise<void>;

  /**
   * Remove role constraints from an agent.
   * Cleanup any permission-related resources.
   */
  removeRoleConstraints(agentId: string): Promise<void>;
}

export interface Backend {
  /** Install a workflow (create agents/workspaces) */
  install(workflow: WorkflowSpec, sourceDir: string): Promise<void>;

  /** Uninstall a workflow (remove agents/workspaces) */
  uninstall(workflowId: string): Promise<void>;

  /** Start a workflow run (activate agents) */
  startRun(workflow: WorkflowSpec): Promise<void>;

  /** Stop a workflow run (deactivate agents) */
  stopRun(workflow: WorkflowSpec): Promise<void>;

  /**
   * Configure a single agent within a workflow.
   * Called per-agent after install to set up role-specific constraints.
   */
  configureAgent(workflow: WorkflowSpec, agent: WorkflowAgent): Promise<void>;

  /**
   * Remove a single agent from a workflow.
   * Called per-agent during uninstall.
   */
  removeAgent(workflowId: string, agentId: string): Promise<void>;

  /**
   * Validate a workflow configuration before installation.
   * Returns detailed validation results with errors and warnings.
   */
  validate(workflow: WorkflowSpec): Promise<ValidationResult>;

  /**
   * Backend capabilities - describes what features this backend supports.
   */
  readonly capabilities: BackendCapabilities;

  /**
   * Permission adapter for role-based constraint management.
   */
  readonly permissionAdapter: PermissionAdapter;

  /**
   * Spawn an agent for interactive execution (optional).
   * Only supported by scheduler-driven backends (ClaudeCode, Codex).
   */
  spawnAgent?(workflow: WorkflowSpec, agent: WorkflowAgent, prompt: string): Promise<SpawnResult>;
}
