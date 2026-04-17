# Hermes Backend Integration - Implementation Plan

> **Date:** 2026-04-17  
> **Status:** Completed  
> **Design Doc:** [2026-04-17-hermes-backend-design.md](./2026-04-17-hermes-backend-design.md)

---

## Task Summary

| Task | Description | Status |
|------|-------------|--------|
| 1 | Create Backend Interface | ✅ Complete |
| 2 | Extract OpenClaw Backend | ✅ Complete |
| 3 | Implement Hermes Backend | ✅ Complete |
| 4 | Add Config Resolver | ✅ Complete |
| 5 | Modify Installer | ✅ Complete |
| 6 | Modify Run Command | ✅ Complete |
| 7 | Extend CLI Options | ✅ Complete |
| 8 | Add Config File Support | ✅ Complete |
| 9 | Integration Tests | ✅ Complete |
| 10 | Documentation | ✅ Complete |

---

## Task Details

### Task 1: Create Backend Interface

**Files:**
- Create: `src/backend/interface.ts`
- Create: `src/backend/index.ts`
- Test: `tests/backend/interface.test.ts`

**Implementation:**
```typescript
export type BackendType = 'openclaw' | 'hermes';

export interface Backend {
  install(workflow: WorkflowSpec, sourceDir: string): Promise<void>;
  uninstall(workflowId: string): Promise<void>;
  startRun(workflow: WorkflowSpec): Promise<void>;
  stopRun(workflow: WorkflowSpec): Promise<void>;
}

export function createBackend(type: BackendType): Backend {
  // Factory implementation
}
```

---

### Task 2: Extract OpenClaw Backend

**Files:**
- Create: `src/backend/openclaw.ts`
- Modify: `src/installer/install.ts` (remove extracted code)
- Test: `tests/backend/openclaw.test.ts`

**Key Functions Extracted:**
- `provisionAgents()` - Already in separate file
- Role policies and timeout configuration
- OpenClaw config management
- Cron job creation via `createAgentCronJob()`

**Notes:**
- Moved `getMaxRoleTimeoutSeconds()` from install.ts to openclaw.ts
- Updated imports in `step-ops.ts` and `checks.ts`

---

### Task 3: Implement Hermes Backend

**Files:**
- Create: `src/backend/hermes.ts`
- Test: `tests/backend/hermes.test.ts`

**Implementation Details:**

```typescript
export class HermesBackend implements Backend {
  async install(workflow: WorkflowSpec, sourceDir: string): Promise<void> {
    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);
      await this.createProfile(profileName);
      await this.createWorkspace(profileName, workflow, agent, sourceDir);
      await this.configureProfile(profileName, agent);
      await this.setupCron(profileName, workflow.id, agent.id);
    }
  }
  // ... other methods
}
```

**Key Design:**
- Profile naming: `{workflowId}-{agentId}`
- Cron jobs stored in `~/.hermes/profiles/{name}/cron/jobs.json`
- Uses `buildPollingPrompt()` from existing agent-cron.ts

---

### Task 4: Add Config Resolver

**Files:**
- Create: `src/backend/config-resolver.ts`
- Test: `tests/backend/config-resolver.test.ts`

**Priority Hierarchy:**
```typescript
export async function resolveBackendConfig(
  agent: WorkflowAgent,
  workflow: WorkflowSpec,
  cliBackend?: BackendType
): Promise<ResolvedBackendConfig> {
  if (cliBackend) return { type: cliBackend, source: 'cli' };
  if (agent.backend) return { type: agent.backend, source: 'agent' };
  if (workflow.defaultBackend) return { type: workflow.defaultBackend, source: 'workflow' };
  const globalConfig = await readAntfarmConfig();
  if (globalConfig.defaultBackend) return { type: globalConfig.defaultBackend, source: 'global' };
  return { type: 'openclaw', source: 'default' };
}
```

---

### Task 5: Modify Installer

**Files:**
- Modify: `src/installer/install.ts`
- Modify: `src/installer/types.ts` (add backend fields)

**Changes:**
```typescript
export async function installWorkflow(params: { 
  workflowId: string; 
  backend?: BackendType 
}): Promise<WorkflowInstallResult> {
  const { workflowDir, bundledSourceDir } = await fetchWorkflow(params.workflowId);
  const workflow = await loadWorkflowSpec(workflowDir);
  const resolved = await resolveBackendConfig(firstAgent, workflow, params.backend);
  const backend = createBackend(resolved.type);
  await backend.install(workflow, bundledSourceDir);
  // ...
}
```

---

### Task 6: Modify Run Command

**Files:**
- Modify: `src/installer/run.ts`
- Modify: `src/installer/status.ts`

**Changes:**
- `runWorkflow()` now calls `backend.startRun(workflow)`
- `stopWorkflow()` now calls `backend.stopRun(workflow)`

---

### Task 7: Extend CLI Options

**Files:**
- Modify: `src/cli/cli.ts`

**New Options:**
```
antfarm workflow install <name> --backend <openclaw|hermes>
antfarm workflow run <name> <task> --backend <openclaw|hermes>
```

**Implementation:**
- Parse `--backend` flag from args
- Validate backend type
- Pass to installWorkflow() and runWorkflow()

---

### Task 8: Add Config File Support

**Files:**
- Create: `src/lib/config.ts`

**Config Location:** `~/.config/antfarm/config.yaml`

**Schema:**
```yaml
defaultBackend: hermes
notifications:
  url: https://example.com/webhook
```

**Functions:**
- `readAntfarmConfig()` - Read and parse config
- `writeAntfarmConfig()` - Write config
- `resolveAntfarmConfigPath()` - Get config path

---

### Task 9: Integration Tests

**Files:**
- Create: `tests/backend/interface.test.ts`
- Create: `tests/backend/openclaw.test.ts`
- Create: `tests/backend/hermes.test.ts`
- Create: `tests/backend/config-resolver.test.ts`

**Test Coverage:**
- Backend interface compliance
- Config resolution priority
- Hermes cron job creation
- Backend type validation

---

### Task 10: Documentation

**Files:**
- Create: `docs/superpowers/specs/2026-04-17-hermes-backend-design.md`
- Create: `docs/superpowers/plans/2026-04-17-hermes-backend-plan.md` (this file)
- Update: `README.md` (if needed)

---

## Commits

```
feat: implement HermesBackend
feat: wire up HermesBackend in factory
feat: add backend configuration resolver with priority hierarchy
feat: refactor installer to use backend abstraction
feat: refactor run and stop commands to use backend abstraction
feat: add --backend option to CLI install and run commands
feat: add global config file support for default backend
test: add backend tests for Hermes and config resolver
fix: properly detect global config and update tests
```

---

## Notes

### Code Reuse
- `buildPollingPrompt()` reused from `agent-cron.ts`
- `provisionAgents()` reused (OpenClaw)
- Skills are backend-agnostic

### Design Decisions
1. Single backend per workflow (simplifies state management)
2. Independent workspaces (no sharing between backends)
3. Same execution flow (agentTurn polling)
4. Backward compatible (defaults to openclaw)

### Future Work
- Per-agent backend selection within workflow
- Backend-specific options in config
- Migration utilities
