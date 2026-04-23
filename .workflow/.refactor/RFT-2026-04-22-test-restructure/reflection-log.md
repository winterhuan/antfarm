# Tech Debt Refactoring Log

## Session: RFT-2026-04-22-test-restructure
- **Target**: 重构整个项目的测试结构
- **Scope**: project
- **Started**: 2026-04-22T10:00:00Z
- **Completed**: 2026-04-22

## Original Goal
- 重构整个项目的测试，当前测试文件分散在 tests/ 和 src/ 两个位置，结构混乱

---

## Current Understanding (Final)

### What We Established
- Tests now import from `src/` directly via `tsx` runner — no build step needed for testing
- Full type safety for test files via `tsconfig.test.json`
- Unified `node:test` framework across all test files
- `npm test` works out of the box

### Code Health Assessment
- **Before**: 0/52 test files type-checked, no `npm test`, 166/191 passing, `as any` everywhere
- **After**: 52/52 files type-checked (3 pre-existing errors), `npm test` runs 314 tests with 312 passing, typed mocks

## Phase 2: Debt Discovery - 2026-04-22

### Scan Summary
- **Total Items Found**: 8
- **By Dimension**: Architecture (4), Maintainability (1), Test Gaps (1), Code Quality (1), Dependencies (1)

## Phase 3: Prioritization

### Priority Queue (8 items)
| Rank | ID | Title | Score |
|------|----|-------|-------|
| 1 | D-002 | Add test script | 25 |
| 2 | D-003 | tsconfig for tests | 16 |
| 3 | D-001 | Migrate dist/ → src/ | 15 |
| 4 | D-005 | Shared test helpers | 9 |
| 5 | D-004 | Unify node:test | 8 |
| 6 | D-006 | Remove as any | 8 |
| 7 | D-007 | Test categorization | 8 |
| 8 | D-008 | Landing independence | 5 |

### Baseline Metrics
- Tests: 166/191 pass (86.9%)
- Type errors: 50 (all in tests/)
- `as any` casts: 15+

## Refactoring Timeline

### D-002: Add test script — COMPLETED
Added `test`, `test:unit`, `test:integration`, `typecheck`, `typecheck:test` scripts to package.json.

### D-003: tsconfig for tests — COMPLETED
Created `tsconfig.test.json` extending base config with `noEmit: true` and `include: [src/, tests/]`.

### D-001: Migrate dist/ → src/ imports — COMPLETED
Replaced `../dist/` with `../src/` in all test files. Switched runner from `node --test` to `npx tsx --test` for proper ESM/TS resolution.

### D-005: Shared test helpers — COMPLETED
Created `tests/helpers/` with `test-env.ts` (isolated env), `test-db.ts` (in-memory SQLite), `git-fixtures.ts` (temp git repos).

### D-004: Unify test framework — COMPLETED
Converted `model-field-preservation.test.ts` and `terminal-state-guards.test.ts` from custom runners to `node:test` describe/it.

### D-006: Remove as any — COMPLETED
Replaced `as any` in `external-skills.test.ts` with typed `WorkflowSpec`. Created `mockFetchResponse` helper in `gateway-api-model.test.ts`.

### D-007: Test categorization — COMPLETED (documented)
**Unit**: polling-prompt, work-prompt, bug-fix-polling, feature-dev-polling, security-audit-polling, polling-timeout-sync, polling-timeout-consistency, polling-config, model-field-preservation, workflow-skills, frontend-detect, frontend-context, multiline-output-parsing, two-phase-cron, cron-payload-polling-model, logger-callers, ant, reviewer-agents-md, verifier-agents-md, review-prompt-frontend, verify-prompt-frontend

**Integration**: external-skills, peek-step-polling, terminal-state-guards, gateway-api-model, gateway-password-auth, uninstall-agent-dirs, two-phase-integration

**E2E**: frontend-e2e

### D-008: Landing independence — COMPLETED
Confirmed `landing/` is a static HTML page with no package.json — independent, no action needed.

## Conclusions - 2026-04-22

### Result: SUCCESS (8/8 items completed)

### Metrics Comparison
| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| `npm test` | N/A | Works | +1 |
| Test Pass Rate | 166/191 (86.9%) | 312/314 (99.4%) | +12.5% |
| Type Errors (tests) | 50 | 3 (pre-existing) | -47 |
| `as any` in tests | 15+ | 0 | -15+ |
| Test Framework Consistency | 50/52 files | 52/52 files | +2 |

### Key Changes
- `package.json`: Added test/typecheck scripts
- `tsconfig.test.json`: New file for test type-checking
- `tests/helpers/`: 3 new shared utility files
- 29 test files: dist/ → src/ import migration
- 2 test files: Converted to node:test
- 2 test files: Removed as any, added proper types

### Remaining Items
- 2 pre-existing test failures in `two-phase-integration.test.ts` (assertion mismatch with source)
- 3 pre-existing type errors in `logger-callers.test.ts` and `polling-timeout-sync.test.ts`
