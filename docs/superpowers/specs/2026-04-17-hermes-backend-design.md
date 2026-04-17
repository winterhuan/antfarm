# Hermes Agent Backend Integration - Design Spec

> **Date:** 2026-04-17  
> **Status:** Implemented  
> **Related PR:** Hermes Backend Support for Antfarm

---

## Overview

Add Hermes Agent Backend support to Antfarm alongside the existing OpenClaw backend, allowing users to choose between backends per workflow or per-agent. The integration reuses existing Antfarm core logic (step-ops, db, workflow-spec) while adding a Backend abstraction layer.

## Goals

1. **Backend Abstraction**: Create a clean interface that supports both OpenClaw and Hermes backends
2. **Configuration Hierarchy**: Support backend selection via CLI > Agent-level > Workflow-level > Global > Default
3. **Workspace Isolation**: Each backend manages its own workspace isolation mechanism
4. **Code Reuse**: Share skills and core logic between backends

## Architecture

### Backend Interface

```typescript
export type BackendType = 'openclaw' | 'hermes';

export interface Backend {
  install(workflow: WorkflowSpec, sourceDir: string): Promise<void>;
  uninstall(workflowId: string): Promise<void>;
  startRun(workflow: WorkflowSpec): Promise<void>;
  stopRun(workflow: WorkflowSpec): Promise<void>;
}
```

### Backend Factory

```typescript
export function createBackend(type: BackendType): Backend {
  switch (type) {
    case 'openclaw':
      return new OpenClawBackend();
    case 'hermes':
      return new HermesBackend();
    default:
      throw new Error(`Unknown backend type: ${type}`);
  }
}
```

## Configuration Hierarchy

Priority (highest to lowest):

1. **CLI Argument** (`--backend` flag)
2. **Agent-level** (`agent.backend` in workflow YAML)
3. **Workflow-level** (`defaultBackend` in workflow YAML)
4. **Global Config** (`~/.config/antfarm/config.yaml`)
5. **Hardcoded Default** (`openclaw`)

## Backend Implementations

### OpenClaw Backend

- Manages agents via OpenClaw's agent configuration file
- Creates cron jobs via OpenClaw's HTTP/cron API
- Workspace isolation via agent directories
- Gateway is already running (shared)

### Hermes Backend

- Creates separate Hermes profile per workflow agent
- Profile naming: `{workflowId}-{agentId}`
- Workspace isolation via Docker containers
- Manages Gateway lifecycle per profile
- Stores cron jobs in `~/.hermes/profiles/{name}/cron/jobs.json`

## Key Design Decisions

### 1. Single Backend Per Workflow

All agents in a workflow use the same backend. This simplifies:
- State management
- Workspace coordination
- Run lifecycle management

### 2. Independent Workspaces

Each backend manages its own workspace isolation:
- OpenClaw: `~/.openclaw/workspaces/workflows/{workflow}/{agent}`
- Hermes: `~/.hermes/profiles/{profile}/workspace`

### 3. Shared Skills

Skills are backend-agnostic and reused between implementations.

### 4. Same Execution Flow

Both backends use the same `agentTurn` polling mechanism via the existing `buildPollingPrompt()` function.

## Files Changed

### New Files
- `src/backend/interface.ts` - Backend interface definition
- `src/backend/index.ts` - Factory and exports
- `src/backend/openclaw.ts` - OpenClaw implementation
- `src/backend/hermes.ts` - Hermes implementation
- `src/backend/config-resolver.ts` - Configuration resolution
- `src/lib/config.ts` - Global config file support
- `tests/backend/*.test.ts` - Backend tests

### Modified Files
- `src/installer/install.ts` - Use backend abstraction
- `src/installer/run.ts` - Use backend.startRun()
- `src/installer/status.ts` - Use backend.stopRun()
- `src/installer/types.ts` - Add backend fields
- `src/cli/cli.ts` - Add --backend flag
- `src/medic/checks.ts` - Update imports
- `src/installer/step-ops.ts` - Update imports

## CLI Usage

```bash
# Install with specific backend
antfarm workflow install my-workflow --backend hermes

# Run with specific backend
antfarm workflow run my-workflow "task description" --backend hermes

# Global config file (~/.config/antfarm/config.yaml)
defaultBackend: hermes
```

## Testing

- Backend interface tests
- Config resolver tests
- Hermes backend tests (with mocks)
- OpenClaw backend tests

## Backward Compatibility

- Default backend is `openclaw` (existing behavior)
- Existing workflows work without changes
- CLI flags are optional

## Future Considerations

- Support per-agent backend selection within a workflow
- Backend-specific configuration options
- Migration tools between backends
