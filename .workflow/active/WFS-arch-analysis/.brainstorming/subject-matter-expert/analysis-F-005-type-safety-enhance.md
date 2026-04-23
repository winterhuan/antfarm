# F-005: type-safety-enhance — SME Analysis

## Current Gaps

- `BackendType` is string union but no compile-time protection
- All identifiers are bare `string` (workflowId, stepId, runId, agentId)
- `validateBackendType` uses manual 4-way string comparison
- Adding new backend requires updating type + validator + switch statement

## Branded Type Pattern (src/lib/brands.ts)

```typescript
type Brand<T, B extends string> = T & { readonly __brand: B };

export type WorkflowId = Brand<string, 'WorkflowId'>;
export type StepId = Brand<string, 'StepId'>;
export type RunId = Brand<string, 'RunId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type BackendType = Brand<'openclaw' | 'hermes' | 'claude-code' | 'codex', 'BackendType'>;

// Smart constructors (ONLY way to create branded values)
export function workflowId(raw: string): WorkflowId { return raw as WorkflowId; }
export function stepId(raw: string): StepId { return raw as StepId; }
export function runId(raw: string): RunId { return raw as RunId; }
export function agentId(raw: string): AgentId { return raw as AgentId; }

const VALID_BACKEND_TYPES = new Set(['openclaw', 'hermes', 'claude-code', 'codex']);

export function parseBackendType(raw: string): ValidationResult<BackendType> {
  return VALID_BACKEND_TYPES.has(raw)
    ? { ok: true, value: raw as BackendType }
    : { ok: false, error: `Unknown backend type: "${raw}"` };
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };
```

## Migration Example: types.ts (Before):
```typescript
export type WorkflowStep = {
  id: string;
  agent: string;
  input: string;
};
```

## Migration Example: types.ts (After):
```typescript
import type { StepId, AgentId } from '../lib/brands.js';

export type WorkflowStep = {
  readonly id: StepId;
  readonly agent: AgentId;
  readonly input: string;
};
```

## Discriminated Union for StepResult (Before):
```typescript
export type StepResult = {
  stepId: string;
  status: "done" | "retry" | "blocked";
};
```

## Discriminated Union for StepResult (After):
```typescript
export type StepResult =
  | { readonly stepId: StepId; readonly status: "done"; readonly output: string; readonly completedAt: string; }
  | { readonly stepId: StepId; readonly status: "retry"; readonly retryCount: number; readonly maxRetries: number; }
  | { readonly stepId: StepId; readonly status: "blocked"; readonly blockedBy: StepId; };
```

Enables exhaustive pattern matching in switch statements.
