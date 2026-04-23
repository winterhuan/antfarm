# F-006: immutable-data-models — SME Analysis

## Current State

Every type in types.ts uses mutable fields. Violates CLAUDE.md: "ALWAYS create new objects, NEVER mutate existing ones."

## Proposed: Full types.ts with readonly

All fields MUST be `readonly`. Arrays use `ReadonlyArray`. Records use `Readonly`.

```typescript
import type { StepId, AgentId, RunId, WorkflowId } from '../lib/brands.js';

export type Story = {
  readonly id: string;
  readonly runId: RunId;
  readonly storyIndex: number;
  readonly storyId: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly status: StoryStatus;
  readonly retryCount: number;
  readonly maxRetries: number;
};

export type WorkflowSpec = {
  readonly id: WorkflowId;
  readonly name?: string;
  readonly agents: ReadonlyArray<WorkflowAgent>;
  readonly steps: ReadonlyArray<WorkflowStep>;
  readonly context?: Readonly<Record<string, string>>;
};
```

## Mutation Points Identified

1. **hermes.ts:68-69**: `installed.push(record)` — build new array via spread
2. **openclaw.ts:89-92**: `ensureAgentList` mutates config — create new config object
3. **openclaw.ts:175**: `upsertAgent` uses `Object.assign` — replace with spread
4. **cli.ts resume**: SQL UPDATE statements — NOT affected (DB operations)
5. **step-ops.ts**: Step status updates — use spread: `{ ...story, status: 'running' }`

## Mutable Variant Pattern (Internal Only)

```typescript
// src/lib/mutable.ts -- NEVER export from public API
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// Usage in db.ts for initial construction from parsed data:
import type { Mutable } from '../lib/mutable.js';
```

## Logger Alignment

LogEntry interface SHOULD also get `readonly` — zero-risk since formatEntry only reads fields.

## Application Priority

1. WorkflowSpec (read-only by nature — loaded from YAML)
2. Story type (clear data flow — status transitions create new objects)
3. Step type (after F-001 decomposition)
4. Context maps (lowest priority — high churn)
