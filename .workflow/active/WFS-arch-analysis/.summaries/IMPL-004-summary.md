# Task: IMPL-004 Unify Backend interface with complete lifecycle methods

## Implementation Summary

### Files Modified

1. **src/backend/interface.ts**: Extended Backend interface with new interfaces and methods
   - Added `BackendCapabilities` interface with 4 capability flags
   - Added `ValidationResult` interface for workflow validation
   - Added `SpawnResult` interface for agent spawning
   - Added `PermissionAdapter` interface for role-based constraints
   - Extended `Backend` interface with 4 new methods:
     - `configureAgent(workflow, agent)`: Configure a single agent
     - `removeAgent(workflowId, agentId)`: Remove a single agent
     - `validate(workflow)`: Validate workflow configuration
     - `spawnAgent?(workflow, agent, prompt)`: Optional spawn for interactive backends

2. **src/backend/openclaw.ts**: Implemented new Backend methods
   - Added `capabilities`: supportsPerToolDeny=true, supportsCronManagement=true
   - Added `permissionAdapter`: Applies ROLE_POLICIES constraints
   - Implemented `validate()`: Checks agent tool permissions, duplicate IDs
   - Implemented `configureAgent()`: Creates cron job for agent
   - Implemented `removeAgent()`: Deletes cron job for specific agent

3. **src/backend/hermes.ts**: Implemented new Backend methods
   - Added `capabilities`: supportsPerToolDeny=false (toolset only)
   - Added `permissionAdapter`: Soft guardrails via prompt injection
   - Implemented `validate()`: Verifies profile name validity
   - Implemented `configureAgent()`: Creates profile, workspace, cron
   - Implemented `removeAgent()`: Deletes profile with ownership check

4. **src/backend/claude-code.ts**: Implemented new Backend methods
   - Added `capabilities`: supportsPerToolDeny=true, schedulerDriven=true
   - Added `permissionAdapter`: Writes disallowedTools to subagent frontmatter
   - Implemented `validate()`: Checks .claude/ writability
   - Implemented `configureAgent()`: Creates subagent definition
   - Implemented `removeAgent()`: Removes subagent file
   - Implemented `spawnAgent()`: Spawns `claude -p` subprocess

5. **src/backend/codex.ts**: Implemented new Backend methods
   - Added `capabilities`: supportsSandbox=true, schedulerDriven=true
   - Added `permissionAdapter`: Sets sandbox_mode in config.toml
   - Implemented `validate()`: Verifies ~/.codex/ writability
   - Implemented `configureAgent()`: Creates role overlay and config entry
   - Implemented `removeAgent()`: Removes overlay and config entry
   - Implemented `spawnAgent()`: Spawns `codex exec` subprocess

6. **src/backend/claude-code-spawn.ts**: Added spawn function
   - Added `spawnClaudeProcess()`: Spawns Claude Code process with proper flags
   - Added interfaces for spawn options and results

7. **src/backend/codex-spawn.ts**: Added spawn function
   - Added `spawnCodexProcess()`: Spawns Codex process with proper flags
   - Added interfaces for spawn options and results

8. **src/backend/index.ts**: Updated exports
   - Exported new types: `BackendCapabilities`, `ValidationResult`, `PermissionAdapter`, `SpawnResult`
   - Exported all backend classes

9. **src/backend/interface.test.ts**: Updated existing tests
   - Added tests for new interface components
   - Verified all backend classes implement new interface

10. **src/backend/backend-contract.test.ts** (new): Comprehensive contract tests
    - 30+ parameterized tests for all 4 backends
    - Tests capabilities, permission adapters, lifecycle methods
    - Tests validation, error handling
    - Verifies backend-specific capabilities

## Outputs for Dependent Tasks

### Available Types
```typescript
// Backend capabilities for feature detection
import { BackendCapabilities } from './backend/interface.js';

// Validation result for workflow checks
import { ValidationResult } from './backend/interface.js';

// Permission adapter for role constraints
import { PermissionAdapter } from './backend/interface.js';

// Spawn result for agent execution
import { SpawnResult } from './backend/interface.js';
```

### Integration Points
- **Backend.factory.createBackend(type)**: Create backend with new interface
- **backend.capabilities**: Check feature availability
- **backend.validate(workflow)**: Validate before install
- **backend.configureAgent(workflow, agent)**: Per-agent configuration
- **backend.spawnAgent(workflow, agent, prompt)**: Interactive execution (ClaudeCode, Codex)

### Usage Examples
```typescript
// Check if backend supports per-tool deny
if (backend.capabilities.supportsPerToolDeny) {
  // Apply fine-grained tool restrictions
}

// Validate workflow before install
const result = await backend.validate(workflow);
if (!result.valid) {
  console.error('Validation errors:', result.errors);
  return;
}

// Configure individual agent
await backend.configureAgent(workflow, agent);

// Spawn agent for interactive use (if supported)
if (backend.spawnAgent) {
  const result = await backend.spawnAgent(workflow, agent, 'Do something');
}
```

## Status: Complete

All 4 backends now implement the unified interface with complete lifecycle methods:
- 199 tests passing
- No breaking changes to existing methods
- New capabilities system enables feature detection
- Permission adapters abstract role-based constraints
