# Antfarm Architecture Optimization — Confirmed Guidance Specification

**Generated**: 2026-04-23
**Type**: Architecture Refactoring
**Strategy**: Big-bang refactoring with phased execution
**Roles**: system-architect, test-strategist, subject-matter-expert

---

## 1. Project Positioning & Goals

**CONFIRMED Objective**: Comprehensive architecture optimization of the antfarm multi-agent workflow orchestration system, addressing code volume, module responsibilities, backend consistency, test coverage, error handling, and type safety.

**CONFIRMED Success Criteria**:
- No source file exceeds 400 lines (current max: 1103 lines)
- All 4 backends implement a unified Backend interface with complete lifecycle methods
- CLI commands are independently testable via command registry pattern
- Error handling follows a consistent class hierarchy across all modules
- Unit test coverage ≥ 80% for core modules (step-ops, backend, installer)
- All critical data structures enforce immutability

**CONFIRMED Constraints**:
- CLI command interface MUST remain backward compatible
- Internal APIs MAY break (explicit permission granted)
- Zero new runtime dependencies (keep json5 + yaml only)

---

## 2. Concepts & Terminology

| Term | Definition | Aliases | Category |
|------|------------|---------|----------|
| Backend Abstraction | Interface layer supporting multiple AI model providers with unified lifecycle operations | AI Backend, Model Provider | Infrastructure |
| Workflow Lifecycle | Complete operational cycle from installation through execution to cleanup | Lifecycle Management | Process |
| Agent Provisioning | Creation and configuration of specialized AI agents with defined roles and workspaces | Agent Setup | Runtime |
| Step Operations | Atomic task execution unit with retry logic, template resolution, and output parsing | Task Operations | Workflow |
| Subprocess Scheduler | Orchestrates agent execution through child processes with concurrency control | Process Manager | Execution |
| Cron Orchestration | Time-based automation for agent heartbeats and continuous task execution | Agent Scheduler | Automation |
| Role Guardrails | Safety constraints limiting agent capabilities based on designated roles | Role Constraints | Security |
| Story Management | BDD-style story execution with lifecycle tracking and acceptance criteria | BDD Execution | Testing |
| Command Registry | Pattern for registering CLI commands as independent modules | Command Pattern | CLI |
| Error Hierarchy | Custom error class tree providing structured error classification | Error Classes | Error Handling |

---

## 3. Non-Goals (Out of Scope)

The following are explicitly OUT of scope for this project:

- **Workflow definitions**: Bundled workflow YAMLs (feature-dev, bug-fix, security-audit) will not be modified
- **Database performance**: SQLite layer optimization is excluded; schema and queries remain as-is

---

## 4. System Architect Decisions

### 4.1 step-ops.ts Decomposition

**SELECTED**: Decompose step-ops.ts (1103 lines) by functional domain into 4-5 focused modules.

- **Rationale**: File exceeds 800-line guideline by 38%, mixes parsing, template resolution, step lifecycle, and error handling
- **Target modules**:
  - `step-parser.ts` — Output parsing and KEY: value extraction (~200 lines)
  - `step-template.ts` — Template resolution and variable substitution (~250 lines)
  - `step-lifecycle.ts` — Core step state transitions: claim, complete, fail (~300 lines)
  - `step-runner.ts` — Step execution orchestration and story iteration (~250 lines)
  - `step-utils.ts` — Shared utilities (hash, temp dirs, etc.) (~100 lines)
- **Requirement Level**: MUST — foundation for all other refactoring

### 4.2 Backend Interface Unification

**SELECTED**: Enhance the Backend interface to include spawn/configure/validate methods for complete lifecycle coverage.

- **Rationale**: 4 backends (OpenClaw, Hermes, Claude Code, Codex) have inconsistent abstraction — different spawn logic, policy patterns, and configuration methods
- **Impact**: Each backend MUST implement the unified interface; adapter methods bridge gaps (e.g., Hermes lacks per-tool deny)
- **Requirement Level**: MUST — enables consistent backend testing and extension

### 4.3 CLI Command Registry

**SELECTED**: Extract CLI commands into independent files using a command registry pattern, keeping manual argument parsing.

- **Rationale**: cli.ts (770 lines) has all commands in one function; registry enables per-command testing and independent maintenance
- **Structure**: Each command as `src/cli/commands/<name>.ts` exporting a `CommandHandler` object
- **Requirement Level**: MUST — prerequisite for testability improvements

### 4.4 Error Class Hierarchy

**SELECTED**: Define a custom error class hierarchy (AntfarmError → BackendError, StepError, ConfigError, etc.) and migrate all error handling.

- **Rationale**: Current mix of throw/catch, process.exit(1), and silent error swallowing makes debugging difficult and error handling inconsistent
- **Hierarchy**:
  - `AntfarmError` (base) — code, context, cause chain
  - `BackendError` — backend operation failures
  - `StepError` — step execution failures (with stepId, agentId context)
  - `ConfigError` — configuration validation failures
  - `CliError` — user-facing CLI errors
- **Requirement Level**: MUST — supports all other refactoring work

---

## 5. Subject-Matter Expert Decisions

### 5.1 Type Safety Enhancement

**SELECTED**: Strengthen the type system with branded types, discriminated unions, and strict generics.

- **Rationale**: Many internal functions lack strict types; Backend interface could benefit from discriminated unions for backend-specific config
- **Impact**: All public interfaces MUST have explicit types; internal functions SHOULD use strict generics
- **Requirement Level**: SHOULD — progressive improvement

### 5.2 Immutable Data Models

**SELECTED**: Apply readonly and immutable patterns to critical data structures only (Step, Story, WorkflowSpec, BackendConfig).

- **Rationale**: Full immutability is too disruptive for this refactoring scope; focusing on key data structures provides best ROI
- **Implementation**: Use `readonly` on type definitions, `as const` for literals, spread operators for updates
- **Requirement Level**: SHOULD — applied to core types only

---

## 6. Test Strategist Decisions

### 6.1 Unit Test Coverage

**SELECTED**: Prioritize adding unit tests for core modules, especially step-ops (decomposed) and backend logic.

- **Rationale**: 31 integration tests but sparse unit test coverage; unit tests catch regressions faster and support refactoring confidence
- **Target**: ≥ 80% coverage for src/installer/, src/backend/, src/cli/commands/
- **Requirement Level**: MUST — essential for safe refactoring

### 6.2 Test File Organization

**SELECTED**: Move all test files next to their source files (src/**/*.test.ts pattern).

- **Rationale**: Co-located tests are easier to maintain and discover; current split between src/ unit tests and tests/ integration tests is confusing
- **Implementation**: `tsconfig.test.json` already supports this pattern
- **Requirement Level**: SHOULD — organizational improvement

---

## 7. Cross-Role Integration

**CONFIRMED Integration Points**:

- **Error Hierarchy ↔ Backend Interface**: BackendError extends AntfarmError, used by unified Backend interface methods
- **Type Safety ↔ Immutable Data**: Readonly modifiers applied to Step/Story types support both type safety and immutability goals
- **Test Coverage ↔ Module Decomposition**: Each decomposed module (step-parser, step-template, etc.) gets its own test file
- **CLI Registry ↔ Error Hierarchy**: Command handlers throw CliError for user-facing issues, enabling consistent error display

---

## 8. Risks & Constraints

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking internal APIs during refactoring | High — downstream consumers break | Comprehensive unit tests before each module change |
| Large change set in big-bang approach | Medium — harder to review incrementally | Feature flags or branch-based phased execution |
| Test migration disrupting CI | Medium — existing tests must keep passing | Migrate tests per module, verify CI after each |
| Backend interface changes require 4 implementations | High — all backends must be updated | Define interface first, implement adapters one at a time |

---

## 9. Feature Decomposition

| Feature ID | Name | Description | Related Roles | Priority |
|------------|------|-------------|---------------|----------|
| F-001 | step-ops-decompose | Split step-ops.ts by functional domain into 4-5 focused modules (200-300 lines each) | system-architect | High |
| F-002 | cli-command-registry | Extract CLI commands to registry pattern, each command in its own file | system-architect | High |
| F-003 | backend-interface-unify | Unify Backend interface with complete lifecycle methods (spawn/configure/validate) | system-architect | High |
| F-004 | error-class-hierarchy | Define AntfarmError hierarchy and migrate all error handling to structured classes | system-architect, sme | High |
| F-005 | type-safety-enhance | Strengthen type system with branded types, discriminated unions, strict generics | sme | Medium |
| F-006 | immutable-data-models | Apply readonly/immutable patterns to Step, Story, WorkflowSpec, BackendConfig | sme | Medium |
| F-007 | test-unit-coverage | Add unit tests for core modules, target ≥80% coverage for installer/backend/cli | test-strategist | Medium |
| F-008 | test-patterns | Standardize test utilities and shared fixtures for consistent test authoring | test-strategist | Low |

---

## 10. Next Steps

**⚠️ Automatic Continuation** (auto mode):
- Phase 3: Launch parallel role analysis for system-architect, test-strategist, subject-matter-expert
- Each role produces detailed analysis with specific code-level recommendations
- Phase 4: Cross-role synthesis produces actionable implementation plan

---

## Appendix: Decision Tracking

| Decision ID | Category | Question | Selected | Phase | Rationale |
|-------------|----------|----------|----------|-------|-----------|
| D-001 | Intent | Core pain point | 全面优化 (All) | 2.1 | All architecture issues need addressing |
| D-002 | Intent | Strategy | 大爆炸重构 | 2.1 | Comprehensive plan, phased execution |
| D-003 | Intent | Compatibility | 允许破坏性内部变更 | 2.1 | CLI compatible, internal APIs may break |
| D-004 | Roles | Selected roles | system-architect, test-strategist, sme | 2.2 | Architecture + testing + TS/Node expertise |
| D-005 | sys-arch | step-ops split strategy | 按功能域拆分 | 2.3 | Natural domain boundaries, 200-300 lines each |
| D-006 | sys-arch | Backend unification | 接口统一 | 2.3 | Complete lifecycle in Backend interface |
| D-007 | sys-arch | CLI refactoring | 命令注册表模式 | 2.3 | Per-command testability without new deps |
| D-008 | sys-arch | Error handling | 错误类层次 | 2.3 | Structured errors with context and codes |
| D-009 | test | Test priority | 补全单元测试 | 2.3 | Catch regressions, support refactoring |
| D-010 | test | Test organization | 测试同源码放 | 2.3 | Co-located tests easier to maintain |
| D-011 | sme | Type safety | 强化类型 | 2.3 | Branded types, discriminated unions |
| D-012 | sme | Immutability | 关键数据结构 | 2.3 | Readonly on Step/Story/WorkflowSpec only |
