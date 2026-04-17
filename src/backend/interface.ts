import type { WorkflowSpec } from '../installer/types.js';

export type BackendType = 'openclaw' | 'hermes';

export interface Backend {
  /** Install a workflow (create agents/workspaces) */
  install(workflow: WorkflowSpec, sourceDir: string): Promise<void>;

  /** Uninstall a workflow (remove agents/workspaces) */
  uninstall(workflowId: string): Promise<void>;

  /** Start a workflow run (activate agents) */
  startRun(workflow: WorkflowSpec): Promise<void>;

  /** Stop a workflow run (deactivate agents) */
  stopRun(workflow: WorkflowSpec): Promise<void>;
}
