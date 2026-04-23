# F-007: test-unit-coverage — Test Strategist Analysis

## Coverage Targets

| Module | Current | Target | New Tests |
|--------|---------|--------|-----------|
| installer/ (incl. decomposed step-ops) | ~15% | 85% | ~122 cases |
| backend/ | ~40% | 80% | ~82 cases |
| cli/commands/ | ~10% | 75% | ~37 cases |
| **Total** | -- | -- | **~241 cases / ~3600 lines** |

## Prioritized Execution Order

1. **Phase 1 — F-001 tests**: 45 cases against current monolith. Gating item.
2. **Phase 2 — F-004 tests**: 15-20 cases for error classes. Blocking for F-002/F-003.
3. **Phase 3 — F-003 tests**: ~30 contract + behavioral tests. Parallel with F-001 decomposition.
4. **Phase 4 — F-002 tests**: ~37 command + registry tests. Requires registry extraction.
5. **Phase 5 — Coverage gap fill**: ~120 remaining tests for agent-provision, paths, gateway-api.

## Coverage Measurement

```bash
npx tsx --test --coverage src/**/*.test.ts tests/**/*.test.ts
```

SHOULD be added as `test:coverage` script in package.json. Start as non-blocking CI annotation, promote to blocking gate once baseline established.

Coverage SHOULD exclude: type definitions, barrel exports, entry points with side effects.

## Co-location Strategy

The 29 integration tests in `tests/` SHOULD remain in place. Co-location applies to NEW unit tests only. Exception: if a tests/ file tests only a single function that gets its own source file after decomposition, it MAY be migrated.

## New unit tests go next to source: `src/**/*.test.ts`
## Integration tests stay: `tests/**/*.test.ts`
