# Tasks: Antfarm Architecture Optimization

**Session**: WFS-arch-analysis  
**Plan**: [IMPL_PLAN.md](./IMPL_PLAN.md)  

---

## Phase 1: Foundation

- [x] **IMPL-001**: Implement AntfarmError class hierarchy foundation → [📋](./.task/IMPL-001.json) | [✅](./.summaries/IMPL-001-summary.md)  
  *F-004: Base class + 7 subclasses, MODULE.ACTION.REASON error codes, Object.freeze*

- [ ] **IMPL-002**: Create standardized test patterns and utilities → [📋](./.task/IMPL-002.json)  
  *F-008: 6 builders, CLI harness, DB fixtures, zero new dependencies*

---

## Phase 2: Core Modules (Parallel)

- [ ] **IMPL-003**: Decompose step-ops.ts into 5 focused modules → [📋](./.task/IMPL-003.json)  
  *F-001: 1103 lines → step-parser/template/lifecycle/loop/utils, barrel re-export*
  
- [x] **IMPL-004**: Unify Backend interface with complete lifecycle methods → [📋](./.task/IMPL-004.json) | [✅](./.summaries/IMPL-004-summary.md)  
  *F-003: configureAgent/removeAgent/validate/capabilities, 30 contract tests*

---

## Phase 3: CLI Refactoring

- [ ] **IMPL-005**: Extract CLI commands into registry pattern → [📋](./.task/IMPL-005.json)  
  *F-002: CommandHandler interface, 8 command files, registry dispatch, 37 tests*

---

## Phase 4: Type Safety & Immutability (Parallel)

- [ ] **IMPL-006**: Implement branded types and discriminated unions → [📋](./.task/IMPL-006.json)  
  *F-005: WorkflowId/StepId/RunId/AgentId, smart constructors, ValidationResult<T>*

- [ ] **IMPL-007**: Apply immutability to data models → [📋](./.task/IMPL-007.json)  
  *F-006: readonly types, Mutable<T>, spread-based updates, 5 mutation sites*

---

## Phase 5: Test Coverage

- [ ] **IMPL-008**: Fill unit test coverage gaps to 80%+ → [📋](./.task/IMPL-008.json)  
  *F-007: 241 tests, installer 85%, backend 80%, cli 75%, co-located*

---

## Dependency Graph

```
Phase 1          Phase 2              Phase 3         Phase 4              Phase 5
--------         -------              -------         -------              -------
IMPL-001  ---->  IMPL-003  ---->      IMPL-006  ---->  IMPL-008
(F-004)   |      (F-001)   |          (F-005)   |
          |                v                     |
          |      IMPL-007  (F-006)               |
          |                                      |
          v                                      v
IMPL-002  ------------------------------------>  IMPL-008
(F-008)
          |
          v
IMPL-004  (F-003)
          |
          v
IMPL-005  (F-002)
```

---

## Status Legend

- `- [ ]` = Pending task
- `[- [x]]` = Completed task
- `→ [📋]` = Links to task JSON
- `→ [✅]` = Links to summary (when completed)

---

## Quick Commands

```bash
# View task details
cat .workflow/active/WFS-arch-analysis/.task/IMPL-001.json

# Run tests for a phase
npm test -- step-ops
npx tsx --test src/backend/*.test.ts

# Check coverage
npx tsx --test --coverage src/**/*.test.ts tests/**/*.test.ts

# Verify TypeScript
npx tsc --noEmit
```
