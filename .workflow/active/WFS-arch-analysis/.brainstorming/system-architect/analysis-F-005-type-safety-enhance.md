# Feature F-005: type-safety-enhance — System Architect Analysis

## Current Gaps

1. **Backend interface too generic**: No backend-specific config types
2. **Step/Story status stringly-typed**: Compared with string literals
3. **DB row types are `any`**: Every SQLite result cast with `as { ... }`
4. **No branded types for IDs**: stepId, runId, workflowId all just `string`

## Recommended Enhancements

### Branded Types for IDs

```typescript
type Brand<T, B> = T & { readonly __brand: B };
type StepDbId = Brand<string, 'StepDbId'>;
type StepPublicId = Brand<string, 'StepPublicId'>;
type RunId = Brand<string, 'RunId'>;
type WorkflowId = Brand<string, 'WorkflowId'>;
```

Prevents passing wrong ID type at compile time.

### Discriminated Union for Step Status

```typescript
interface StepPending { status: 'pending'; retryCount: number; }
interface StepRunning { status: 'running'; claimedAt: string; currentStoryId: string | null; }
interface StepDone { status: 'done'; output: string; completedAt: string; }
interface StepFailed { status: 'failed'; output: string; failedAt: string; retryCount: number; }

type StepState = StepPending | StepRunning | StepDone | StepFailed;
```

Enables exhaustive pattern matching.

### Backend-Specific Config via Discriminated Union

```typescript
type BackendConfig =
  | { type: 'openclaw'; rolePolicies: Record<AgentRole, RolePolicy> }
  | { type: 'hermes'; hermesHome: string }
  | { type: 'claude-code'; projectDir: string }
  | { type: 'codex'; codexHome: string };
```

### Strict Row Types

Define interfaces for each query result. Validate at boundary instead of casting with `as`.

## Application Strategy

Apply progressively during F-001 decomposition. Each new module introduces types with branded IDs and discriminated unions from the start.
