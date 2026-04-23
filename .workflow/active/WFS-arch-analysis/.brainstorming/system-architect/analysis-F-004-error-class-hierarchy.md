# Feature F-004: error-class-hierarchy — System Architect Analysis

## Current Anti-Patterns

1. **Generic `throw new Error()`**: Everywhere in step-ops.ts
2. **Silent catch blocks**: 10+ `catch {}` patterns in step-ops.ts
3. **`process.exit(1)` in CLI**: 15+ times in cli.ts
4. **No error context**: Only message strings, no structured metadata
5. **Mixed channels**: Some throw, some return error indicators, some emit events silently

## Proposed Hierarchy

```
AntfarmError (base)
  |-- code: string
  |-- context: Record<string, unknown>
  |-- cause?: Error
  |-- timestamp: string
  |
  +-- BackendError
  |     |-- backendType: BackendType
  |     |-- operation: string
  |     +-- ProfileError
  |           |-- profileName: string
  |           |-- workflowId: string
  |
  +-- StepError
  |     |-- stepId: string
  |     |-- runId: string
  |     |-- workflowId: string
  |     +-- StepRetryExhausted (retryCount, maxRetries)
  |     +-- StoryRetryExhausted (storyId, retryCount)
  |     +-- StepAbandoned (abandonedCount, threshold)
  |
  +-- ConfigError
  |     +-- TemplateError (template, missingKeys[])
  |     +-- ValidationError (field, value)
  |
  +-- CliError
        |-- exitCode: number
        |-- userMessage: string
        +-- UsageError
        +-- NotFoundError (resourceType, resourceIdentifier)
```

## Base Class

```typescript
export class AntfarmError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;
  readonly cause?: Error;
  readonly timestamp: string;

  constructor(opts: { message: string; code: string; context?: Record<string, unknown>; cause?: Error }) {
    super(opts.message);
    this.name = this.constructor.name;
    this.code = opts.code;
    this.context = opts.context ?? {};
    this.cause = opts.cause;
    this.timestamp = new Date().toISOString();
  }
}
```

## Error Code Convention

`MODULE.ACTION.REASON` format:
- `step.claim.not_found`, `step.claim.missing_inputs`
- `step.fail.exhausted`, `step.abandon.threshold`
- `backend.install.profile_create`, `backend.uninstall.ownership`
- `cli.args.missing`, `cli.args.invalid`

## Migration Priority

1. Define hierarchy in `src/lib/errors.ts`
2. Migrate step-ops.ts: `throw new Error()` → `StepError` subclasses
3. Migrate cli.ts: `process.exit(1)` → `throw new CliError()`
4. Migrate backends: generic errors → `BackendError`
5. Do NOT migrate event emission — errors and events are separate concerns
