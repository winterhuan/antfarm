# Implementation Plan: Antfarm Architecture Optimization

**Session**: WFS-arch-analysis  
**Created**: 2026-04-23  
**Plan Version**: 1.0  

---

## Executive Summary

This plan implements 8 architecture optimization features for the antfarm multi-agent workflow orchestration system. The work is organized into 5 phases with careful dependency management to minimize risk while maximizing parallel execution.

**Key Constraints**:  
1. 零新依赖 (json5 + yaml only)  
2. 保持CLI命令兼容  
3. 允许内部API破坏性变更  
4. 文件大小目标: <400 lines per file  
5. 测试覆盖率目标: >=80% for core modules  

---

## Phase Overview

| Phase | Tasks | Features | Goal | Duration |
|-------|-------|----------|------|----------|
| 1 | IMPL-001, IMPL-002 | F-004, F-008 | Foundation (errors + tests) | 3-4 days |
| 2 | IMPL-003, IMPL-004 | F-001, F-003 | Parallel decomposition + backends | 4-5 days |
| 3 | IMPL-005 | F-002 | CLI registry | 2-3 days |
| 4 | IMPL-006, IMPL-007 | F-005, F-006 | Parallel types + immutability | 3-4 days |
| 5 | IMPL-008 | F-007 | Test coverage fill | 3-4 days |

---

## Phase 1: Foundation (Days 1-4)

### IMPL-001: Implement AntfarmError Class Hierarchy

**Status**: pending  
**Feature**: F-004 (error-class-hierarchy)  
**Depends On**: None (foundation)  
**Blocks**: IMPL-003, IMPL-004, IMPL-005, IMPL-006  

**Description**: Define AntfarmError base class with code, context, cause, timestamp and Object.freeze. Create 7 subclasses: BackendError, ProfileError, StepError, StepRetryExhausted, StoryRetryExhausted, StepAbandoned, ConfigError, CliError, TemplateError, ValidationError, UsageError, NotFoundError.

**Files**:
- `src/lib/errors.ts` (create): Base class + all subclasses

**Convergence Criteria**:
1. src/lib/errors.ts exists with AntfarmError base class
2. 7 error subclasses implemented
3. Error code convention MODULE.ACTION.REASON established
4. All instances frozen with Object.freeze
5. 20+ existing throws and 15+ process.exit identified for migration

**Verification**:
```bash
npx tsc --noEmit src/lib/errors.ts && node --input-type=module -e "import('./src/lib/errors.ts').then(m => console.log(Object.keys(m)))"
```

**CLI Execution**: `WFS-arch-analysis-IMPL-001`, strategy: `new`

---

### IMPL-002: Create Standardized Test Patterns and Utilities

**Status**: pending  
**Feature**: F-008 (test-patterns)  
**Depends On**: None (foundation)  
**Blocks**: IMPL-003, IMPL-004, IMPL-005, IMPL-006, IMPL-007, IMPL-008  

**Description**: Implement test data builders (buildWorkflowSpec, buildWorkflowAgent, buildWorkflowStep, buildStory, buildRunRecord, buildBackendSpy), CLI test harness with process interception, and database fixtures. Zero new dependencies.

**Files**:
- `tests/helpers/builders.ts` + `.test.ts` (create)
- `tests/helpers/cli-harness.ts` + `.test.ts` (create)
- `tests/helpers/test-db.ts` (modify): Add fixtures
- `tests/helpers/workspace-fixture.ts` (create)

**Convergence Criteria**:
1. 6 builder functions implemented
2. CLI harness captures stdout/stderr/exit without terminating
3. 3 DB fixture functions added
4. All utilities tested
5. Zero new dependencies

**Verification**:
```bash
npx tsx --test --dry-run tests/helpers/builders.test.ts tests/helpers/cli-harness.test.ts
```

**CLI Execution**: `WFS-arch-analysis-IMPL-002`, strategy: `new`

---

## Phase 2: Core Modules (Days 5-9)

### IMPL-003: Decompose step-ops.ts Into 5 Focused Modules

**Status**: pending  
**Feature**: F-001 (step-ops-decompose)  
**Depends On**: IMPL-001  
**Blocks**: IMPL-006, IMPL-007  

**Description**: Split 1103-line step-ops.ts into step-parser (~200), step-template (~150), step-lifecycle (~350), step-loop (~200), step-utils (~100). Use barrel re-export at src/installer/step-ops/index.ts for zero-breakage migration.

**Files**:
- `src/installer/step-parser.ts` (create)
- `src/installer/step-template.ts` (create)
- `src/installer/step-lifecycle.ts` (create)
- `src/installer/step-loop.ts` (create)
- `src/installer/step-utils.ts` (create)
- `src/installer/step-ops/index.ts` (create): Barrel re-export
- `src/installer/step-ops.ts` (modify): Deprecation notice

**Convergence Criteria**:
1. 5 new modules created with correct line counts
2. Barrel re-export works for zero breakage
3. 45 test cases pass before and after
4. All existing imports continue to work
5. Each module <400 lines

**Verification**:
```bash
npm test -- step-ops && ls -la src/installer/step-ops/ | wc -l
```

**CLI Execution**: `WFS-arch-analysis-IMPL-003`, strategy: `resume` from `WFS-arch-analysis-IMPL-001`

---

### IMPL-004: Unify Backend Interface

**Status**: pending  
**Feature**: F-003 (backend-interface-unify)  
**Depends On**: IMPL-001  
**Blocks**: None  

**Description**: Extend Backend interface with configureAgent, removeAgent, validate, capabilities. Add optional spawnAgent?() for interactive backends. Implement BackendCapabilities and PermissionAdapter. Write 30 parameterized contract tests.

**Files**:
- `src/backend/interface.ts` (modify): New methods + types
- `src/backend/openclaw.ts` (modify): Implement new interface
- `src/backend/hermes.ts` (modify): Implement new interface
- `src/backend/claude-code.ts` (modify): Implement + spawnAgent
- `src/backend/codex.ts` (modify): Implement + spawnAgent
- `src/backend/backend-contract.test.ts` (create): 30 parameterized tests

**Convergence Criteria**:
1. Backend interface extended with 4 new methods
2. BackendCapabilities with 4 boolean flags
3. PermissionAdapter pattern implemented
4. All 4 backends implement new interface
5. 30 contract tests pass

**Verification**:
```bash
npm test -- backend && npx tsx --test src/backend/*.test.ts
```

**CLI Execution**: `WFS-arch-analysis-IMPL-004`, strategy: `resume` from `WFS-arch-analysis-IMPL-001`

---

## Phase 3: CLI Refactoring (Days 10-12)

### IMPL-005: Extract CLI Commands Into Registry Pattern

**Status**: pending  
**Feature**: F-002 (cli-command-registry)  
**Depends On**: IMPL-001  
**Blocks**: None  

**Description**: Refactor 770-line cli.ts into CommandHandler interface + registry dispatch. Create src/cli/commands/*.ts for each command group. Extract utilities to src/cli/utils.ts. Implement createCliHarness() test pattern.

**Files**:
- `src/cli/command-handler.ts` (create): Types
- `src/cli/registry.ts` (create): Dispatch
- `src/cli/utils.ts` (create): Shared utilities
- `src/cli/commands/version.ts` (create)
- `src/cli/commands/install.ts` (create)
- `src/cli/commands/uninstall.ts` (create)
- `src/cli/commands/dashboard.ts` (create)
- `src/cli/commands/medic.ts` (create)
- `src/cli/commands/step.ts` (create)
- `src/cli/commands/logs.ts` (create)
- `src/cli/commands/workflow.ts` (create)
- `src/cli/cli.ts` (modify): Reduce to dispatch

**Convergence Criteria**:
1. CommandHandler interface defined
2. 8 command files created
3. Registry dispatch implemented
4. 37 command + registry tests pass
5. main() <50 lines
6. Zero breaking changes to CLI interface

**Verification**:
```bash
npm test -- cli && node src/cli/ant.ts --version
```

**CLI Execution**: `WFS-arch-analysis-IMPL-005`, strategy: `resume` from `WFS-arch-analysis-IMPL-001`

---

## Phase 4: Type Safety & Immutability (Days 13-16)

### IMPL-006: Implement Branded Types and Discriminated Unions

**Status**: pending  
**Feature**: F-005 (type-safety-enhance)  
**Depends On**: IMPL-001, IMPL-003  
**Blocks**: None  

**Description**: Create branded types for IDs (WorkflowId, StepId, RunId, AgentId). Implement discriminated unions for StepResult and BackendConfig. Add smart constructors. Create ValidationResult<T> pattern.

**Files**:
- `src/types/branded.ts` (create): Brand type + IDs + constructors
- `src/types/unions.ts` (create): Discriminated unions
- `src/types/validation.ts` (create): ValidationResult<T>
- `src/types/index.ts` (create): Barrel export
- `src/installer/types.ts` (modify): Apply branded types
- `src/backend/interface.ts` (modify): Use unions

**Convergence Criteria**:
1. Brand<T, B> type and branded ID types defined
2. 4 smart constructor functions
3. Discriminated unions for StepResult and BackendConfig
4. ValidationResult<T> with success/failure
5. All types compile with strict mode

**Verification**:
```bash
npx tsc --noEmit && node --input-type=module -e "import('./src/types/branded.js').then(m => console.log('Branded types OK'))"
```

**CLI Execution**: `WFS-arch-analysis-IMPL-006`, strategy: `merge_fork` from `WFS-arch-analysis-IMPL-001` and `WFS-arch-analysis-IMPL-003`

---

### IMPL-007: Apply Immutability to Data Models

**Status**: pending  
**Feature**: F-006 (immutable-data-models)  
**Depends On**: IMPL-003, IMPL-006  
**Blocks**: None  

**Description**: Apply readonly to WorkflowSpec, Story, Step, Context. Use ReadonlyArray and Readonly<Record>. Create Mutable<T> variant for DB construction. Convert 5 mutation sites to spread-based updates.

**Files**:
- `src/types/immutable.ts` (create): Mutable<T>, DeepReadonly<T>
- `src/installer/types.ts` (modify): Add readonly
- `src/installer/step-lifecycle.ts` (modify): Convert mutations
- `src/db.ts` (modify): Use Mutable<T> for construction

**Convergence Criteria**:
1. Mutable<T> utility defined
2. WorkflowSpec, Story, Step marked readonly
3. Context maps use Readonly<Record>
4. 5 mutation sites converted to spread
5. DB construction uses Mutable<T>

**Verification**:
```bash
npx tsc --noEmit && grep -c 'readonly' src/installer/types.ts >= 10
```

**CLI Execution**: `WFS-arch-analysis-IMPL-007`, strategy: `merge_fork` from `WFS-arch-analysis-IMPL-003` and `WFS-arch-analysis-IMPL-006`

---

## Phase 5: Test Coverage (Days 17-20)

### IMPL-008: Fill Unit Test Coverage to 80%+

**Status**: pending  
**Feature**: F-007 (test-unit-coverage)  
**Depends On**: IMPL-002, IMPL-003, IMPL-004, IMPL-005, IMPL-006, IMPL-007  
**Blocks**: None (final phase)  

**Description**: Add ~241 new unit tests. Targets: installer 85%, backend 80%, cli 75%. Co-locate with source. Use patterns from IMPL-002.

**Files** (representative):
- `src/installer/step-parser.test.ts` (create)
- `src/installer/step-template.test.ts` (create)
- `src/installer/step-lifecycle.test.ts` (create)
- `src/installer/step-utils.test.ts` (create)
- `src/installer/step-loop.test.ts` (create)
- `src/installer/errors.test.ts` (create)
- `src/installer/types.test.ts` (create)
- `src/backend/backend-contract.test.ts` (create)
- `src/backend/openclaw.test.ts` (modify)
- `src/backend/hermes.test.ts` (modify)
- `src/backend/claude-code.test.ts` (modify)
- `src/backend/codex.test.ts` (modify)
- `src/cli/registry.test.ts` (create)
- `src/cli/utils.test.ts` (create)
- `src/cli/commands/*.test.ts` (create)

**Convergence Criteria**:
1. 241 new unit tests added
2. src/installer/* coverage >=85%
3. src/backend/* coverage >=80%
4. src/cli/* coverage >=75%
5. Tests co-located with source
6. All new tests pass
7. No regressions

**Verification**:
```bash
npx tsx --test --coverage src/**/*.test.ts tests/**/*.test.ts | grep -E '(installer|backend|cli).*\\d+%'
```

**CLI Execution**: `WFS-arch-analysis-IMPL-008`, strategy: `merge_fork` from all prior tasks

---

## Dependency Graph

```
IMPL-001 (F-004) -----> IMPL-003 (F-001) -----> IMPL-006 (F-005)
      |                      |                       |
      |                      v                       v
      |               IMPL-007 (F-006)              |
      |                      |                       |
      v                      v                       v
IMPL-002 (F-008) --------------------------------> IMPL-008 (F-007)
      |
      v
IMPL-004 (F-003)
      |
IMPL-005 (F-002)
```

**Parallel Groups**:
- Group 1: IMPL-001, IMPL-002 (Phase 1 - Foundation)
- Group 2: IMPL-003, IMPL-004 (Phase 2 - Parallel Core)
- Group 3: IMPL-005 (Phase 3 - CLI)
- Group 4: IMPL-006, IMPL-007 (Phase 4 - Parallel Types)
- Group 5: IMPL-008 (Phase 5 - Tests)

---

## Cross-Task Dependencies Summary

| Task | Depends On | Blocks |
|------|------------|--------|
| IMPL-001 | - | IMPL-003, IMPL-004, IMPL-005, IMPL-006 |
| IMPL-002 | - | IMPL-003, IMPL-004, IMPL-005, IMPL-006, IMPL-007, IMPL-008 |
| IMPL-003 | IMPL-001 | IMPL-006, IMPL-007 |
| IMPL-004 | IMPL-001 | - |
| IMPL-005 | IMPL-001 | - |
| IMPL-006 | IMPL-001, IMPL-003 | - |
| IMPL-007 | IMPL-003, IMPL-006 | - |
| IMPL-008 | IMPL-002, IMPL-003, IMPL-004, IMPL-005, IMPL-006, IMPL-007 | - |

---

## N+1 Context

### Decisions Made

| Decision | Rationale | Revisit? |
|----------|-----------|----------|
| 5-phase execution order | Foundation first, then parallel, CLI separate, types+immutability parallel, tests last | No |
| Barrel re-export for F-001 | Zero-breakage migration pattern | No |
| CommandHandler for F-002 | Per-command testability without new deps | No |
| Parallel phases 2 and 4 | F-001/F-003 and F-005/F-006 have no inter-dependencies | No |
| IMPL-008 merges all prior contexts | Test task needs full picture of all changes | No |

### Deferred Items

- [ ] Phase 5 UI Design Exploration (skipped per user request)
- [ ] Advanced backend permission adapters (beyond interface definition)
- [ ] Performance optimization of immutable patterns
- [ ] Migration guide for external users (not needed - internal API changes allowed)

---

## Appendix A: Task Reference

| ID | Feature | Title | Effort | Priority |
|----|---------|-------|--------|----------|
| IMPL-001 | F-004 | Error hierarchy foundation | Medium | Critical |
| IMPL-002 | F-008 | Test patterns | Medium | High |
| IMPL-003 | F-001 | Step-ops decomposition | Large | High |
| IMPL-004 | F-003 | Backend interface unification | Large | High |
| IMPL-005 | F-002 | CLI command registry | Large | High |
| IMPL-006 | F-005 | Type safety enhancement | Medium | Medium |
| IMPL-007 | F-006 | Immutable data models | Medium | Medium |
| IMPL-008 | F-007 | Test coverage fill | Large | Medium |

---

## Appendix B: Feature Reference

| Feature | Description | Priority | Dependencies |
|---------|-------------|----------|--------------|
| F-001 | Step-ops decomposition (1103 -> 5 modules) | High | F-004 |
| F-002 | CLI command registry pattern | High | F-004 |
| F-003 | Backend interface unification | High | F-004 |
| F-004 | Error class hierarchy (base + 7 subclasses) | High | - |
| F-005 | Type safety enhancement (branded types) | Medium | F-004, F-001 |
| F-006 | Immutable data models | Medium | F-001, F-005 |
| F-007 | Test coverage fill (241 tests, 80%+) | Medium | F-001, F-002, F-003, F-008 |
| F-008 | Test patterns (builders, harness, fixtures) | Low | - |

---

*Plan generated by action-planning-agent for WFS-arch-analysis*
