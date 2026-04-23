# Cross-Cutting Test Strategy: Test Strategist

## Coverage Gap Summary

| Module | Lines | Risk | Has Tests? |
|--------|-------|------|------------|
| installer/step-ops | 1103 | Critical | No |
| cli/cli | 770 | High | Shallow (91 lines) |
| installer/gateway-api | 422 | High | No |
| installer/agent-cron | 276 | Medium | Indirect only |
| installer/agent-provision | 178 | Medium | No |

## Test Execution Order Dependency

```
F-004 (error hierarchy) -- no dependencies, write first
F-008 (test patterns)   -- standardize helpers alongside F-004
F-003 (backend unify)   -- depends on F-004 error types
F-001 (step-ops)        -- depends on F-004 error types
F-002 (cli registry)    -- depends on F-004 error types
F-007 (coverage)         -- final pass, fill gaps
```

## F-004: Error Class Hierarchy Tests

**Required tests**:
- `AntfarmError` has `code`, `context`, `cause` properties
- Cause chain preserves original error
- Subclass tests: BackendError, StepError, ConfigError, CliError
- Grep test: no file in core modules calls `process.exit(1)` directly
- Every F-001/F-002/F-003 test verifies correct error subclass

## F-003: Backend Interface Unification Tests

**Contract test pattern**: `runBackendContractTests(backendType, createInstance)` — runs same suite against all 4 backends.
- `validate()` rejects invalid config
- `configure()` is idempotent
- `spawn()` returns process handle or throws `BackendError`

## F-002: CLI Command Registry Tests

**Key pattern**: `createCliHarness()` intercepts `process.exit`, `stdout.write`, `stderr.write` via `mock.method()`.
- Per-command unit tests (one file per command)
- Registry mechanism: lookup, unknown command, help generation

## Key Recommendations

1. Tests MUST be written before refactoring begins
2. Extract pure functions first, test them, then restructure
3. Standardize spy/stub pattern from run.test.ts
4. Mandate node:test + node:assert/strict (zero new deps)
5. Target 80% line coverage for core modules (~241 new test cases)

## Risks

- **52% modules uncovered**: Big-bang without safety net is high risk
- **Test migration disruption**: Keep integration tests in place, add co-located unit tests only
- **Helper duplication**: Single tests/helpers/ location, no parallel directories
