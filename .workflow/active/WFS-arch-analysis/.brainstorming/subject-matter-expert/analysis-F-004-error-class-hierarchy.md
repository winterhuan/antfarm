# F-004: error-class-hierarchy — SME Analysis

## Current Anti-Patterns

- `throw new Error()` in config-resolver, hermes, codex, openclaw
- `process.exit(1)` 15+ times in cli.ts
- Silent catch blocks in hermes.ts (lines 91, 113, 118, 207, 222), codex.ts (134)
- Violates CLAUDE.md: "Never silently swallow errors"

## Proposed Hierarchy (src/lib/errors.ts)

```typescript
export class AntfarmError extends Error {
  readonly code: string;
  readonly timestamp: string;

  constructor(message: string, opts?: { code?: string; cause?: Error }) {
    super(message, { cause: opts?.cause });
    this.name = this.constructor.name;
    this.code = opts?.code ?? 'ERR_ANTFARM_UNKNOWN';
    this.timestamp = new Date().toISOString();
    Object.freeze(this);
  }
}

export class BackendError extends AntfarmError {
  readonly backendType: string;
}

export class BackendInstallError extends BackendError {
  readonly workflowId: string;
  readonly agentId?: string;
}

export class StepError extends AntfarmError {
  readonly stepId: string;
  readonly agentId: string;
  readonly runId: string;
}

export class ConfigError extends AntfarmError {
  readonly configPath?: string;
}

export class CliError extends AntfarmError {
  readonly exitCode: number;
}
```

## Key Design Decisions

1. **`Object.freeze(this)`**: Enforces immutability on error instances
2. **`name = constructor.name`**: Ensures instanceof works correctly
3. **`cause` via options bag**: ECMAScript 2022 standard, Node 22+ native
4. **No abstract methods**: Compatible with procedural code style

## Migration Examples

### config-resolver.ts (Before):
```typescript
throw new Error(`Unknown backend type: ${type}`);
```

### config-resolver.ts (After):
```typescript
throw new ConfigError(`Unknown backend type: ${type}`, { code: 'ERR_CONFIG_BACKEND_TYPE' });
```

### cli.ts (Before):
```typescript
if (!target) { process.stderr.write("Missing agent-id.\n"); process.exit(1); }
```

### cli.ts (After):
```typescript
if (!target) { throw new CliError("Missing agent-id.", { code: 'ERR_CLI_MISSING_ARG' }); }
```

Top-level `main().catch()` handles `CliError` with appropriate exit codes.
