# Feature F-006: immutable-data-models — System Architect Analysis

## Current State

`Story` and `WorkflowSpec` types are fully mutable. step-ops.ts mutates `context` in place.

## Recommended Readonly Application

### Story Type

```typescript
export type Story = {
  readonly id: string;
  readonly runId: string;
  readonly storyIndex: number;
  readonly storyId: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
  readonly status: "pending" | "running" | "done" | "failed";
  readonly output?: string;
  readonly retryCount: number;
  readonly maxRetries: number;
};
```

Status transitions: `{ ...story, status: 'running' }` instead of `story.status = 'running'`.

### WorkflowSpec Type

```typescript
export type WorkflowSpec = {
  readonly id: string;
  readonly name?: string;
  readonly version?: number;
  readonly defaultBackend?: BackendType;
  readonly polling?: Readonly<PollingConfig>;
  readonly agents: readonly WorkflowAgent[];
  readonly steps: readonly WorkflowStep[];
  readonly context?: Readonly<Record<string, string>>;
};
```

### Context Maps

```typescript
function mergeContext(
  context: Readonly<Record<string, string>>,
  parsed: Readonly<Record<string, string>>
): Record<string, string> {
  return { ...context, ...parsed };
}
```

## Where NOT to Apply Immutability

- **DB operations**: SQLite UPDATE is inherently mutable. Don't add complexity.
- **Backend config objects**: OpenClaw's config mutation is deeply coupled to its file format.
- **context object in claimStep**: High churn, significant refactoring required.

## Application Priority

1. WorkflowSpec (read-only by nature — loaded from YAML)
2. Story type (clear data flow)
3. Step type (after F-001 decomposition)
4. Context maps (lowest priority)
