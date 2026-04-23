# Cross-Cutting: SME TypeScript/Node.js Best Practices

## Branded Types as Foundation

The single most impactful type-level change is branded types for domain identifiers. Zero runtime overhead.

| Current type | Proposed brand | Used in |
|---|---|---|
| `string` (workflow id) | `WorkflowId` | WorkflowSpec, runs, backend methods |
| `string` (step id) | `StepId` | WorkflowStep, step-ops |
| `string` (run id) | `RunId` | Stories, runs |
| `string` (agent id) | `AgentId` | Agents, cron, step-ops |
| `BackendType` (union) | branded `BackendType` | Backend, config-resolver |

## Migration Order

```
F-004 (Error Hierarchy) -- foundation for validation failures
  |
  +---> F-005 (Type Safety) -- depends on error classes
  |
  +---> F-006 (Immutability) -- depends on branded types
```

F-006 CAN be done in parallel with F-004 if scoped to types.ts only.

## F-001/F-002/F-003 TS Best Practices

- **Decomposed modules** (F-001): Each new file introduces branded IDs and discriminated unions from the start
- **CLI registry** (F-002): CommandHandler interface uses branded CommandContext; no process.exit in handlers
- **Backend interface** (F-003): BackendError subclasses for each method; capabilities as discriminated union

## Runtime Validation Pattern (Zero New Deps)

```typescript
type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };
```

Replaces ad-hoc string comparison. Composes better than try/catch.

## Naming Conventions

| Category | Convention | Example |
|---|---|---|
| Error classes | PascalCase, `Error` suffix | `BackendInstallError` |
| Error codes | UPPER_SNAKE_CASE | `ERR_BACKEND_UNREACHABLE` |
| Branded types | PascalCase | `WorkflowId`, `StepId` |
| Brand functions | `parse` prefix | `parseBackendType()` |

## Node.js Platform Notes

- Engine: Node >= 22 (node:sqlite, Promise.withResolvers, stable ESM)
- Testing: node:test + node:assert/strict via tsx
- Module pattern: All ESM with .js extension in imports
