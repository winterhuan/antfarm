# Feature F-003: backend-interface-unify — System Architect Analysis

## Current State

Backend interface has 4 methods. 4 implementations differ significantly:

| Capability | OpenClaw | Hermes | ClaudeCode | Codex |
|------------|----------|--------|------------|-------|
| install | provisionAgents + cron | profile creation + cron | provisionAgents + subagent files | provisionAgents + config.toml |
| uninstall | cron deletion | profile deletion + cron | subagent removal | config.toml cleanup |
| startRun | no-op | gateway start | no-op | no-op |
| stopRun | cron deletion | gateway stop | no-op | no-op |
| Permission model | per-tool deny list | soft guardrails (prompt) | --disallowedTools CLI | sandbox_mode (OS-level) |

## Proposed Enhanced Interface

```typescript
export interface Backend {
  // Lifecycle (existing)
  install(workflow: WorkflowSpec, sourceDir: string): Promise<void>;
  uninstall(workflowId: string): Promise<void>;
  startRun(workflow: WorkflowSpec): Promise<void>;
  stopRun(workflow: WorkflowSpec): Promise<void>;

  // Agent lifecycle (new)
  configureAgent(workflow: WorkflowSpec, agent: WorkflowAgent): Promise<void>;
  removeAgent(workflowId: string, agentId: string): Promise<void>;

  // Execution (new, optional)
  spawnAgent?(workflow: WorkflowSpec, agent: WorkflowAgent, prompt: string): Promise<SpawnResult>;

  // Validation (new)
  validate(workflow: WorkflowSpec): Promise<ValidationResult>;

  // Capabilities (new)
  readonly capabilities: BackendCapabilities;
}

export interface BackendCapabilities {
  supportsPerToolDeny: boolean;
  supportsSandbox: boolean;
  schedulerDriven: boolean;
  supportsCronManagement: boolean;
}
```

## Migration Path

1. **Add capabilities**: Each backend declares what it supports. Eliminates `if (backend === 'hermes')` checks.
2. **Add validate()**: OpenClaw checks agent tool permissions; Hermes verifies profile names; ClaudeCode checks `.claude/` writable.
3. **Add configureAgent/removeAgent**: Extract per-agent setup from `install()`. Allows partial reconfiguration.
4. **Make spawnAgent optional**: Only ClaudeCode and Codex support direct subprocess spawning.
5. **Keep existing 4 methods unchanged**: Backward compatibility.

## Permission Adapter

```typescript
export interface PermissionAdapter {
  applyRoleConstraints(agent: WorkflowAgent): Promise<void>;
  removeRoleConstraints(agentId: string): Promise<void>;
}
```

OpenClaw: ROLE_POLICIES + config mutation. Hermes: prompt injection. ClaudeCode: --disallowedTools. Codex: sandbox_mode.

## Note: startRun/stopRun No-Ops

3/4 backends have no-op for startRun/stopRun. Consider making these optional or adding `schedulerDriven` capability flag.
