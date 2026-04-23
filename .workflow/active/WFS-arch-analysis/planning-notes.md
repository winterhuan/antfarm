# Planning Notes

**Session**: WFS-arch-analysis
**Created**: 2026-04-23T00:00:00Z

## User Intent (Phase 1)

- **GOAL**: 制定 antfarm 项目架构优化的详细分阶段实施计划
- **KEY_CONSTRAINTS**: 零新依赖，保持CLI兼容，允许内部API破坏

---

## Context Findings (Phase 2)

- **CRITICAL_FILES**: src/installer/step-ops.ts (1103 lines), src/cli/cli.ts (770 lines), src/server/subprocess-scheduler.ts (566 lines), src/backend/interface.ts, src/backend/config-resolver.ts
- **ARCHITECTURE**: Plugin backend system (4 implementations), Strategy pattern for backend selection, Subprocess-based scheduling, Cron-driven orchestration, Polling model with step state machine, Story-based loop execution, Event sourcing for observability, Health watchdog (Medic)
- **CONFLICT_RISK**: low
- **CONSTRAINTS**: Zero new dependencies (json5 + yaml only), Node.js >= 22, node:sqlite (synchronous), ESM with NodeNext, node:test via tsx

## Conflict Decisions (Phase 3)
Skipped — brainstorm analysis shows no conflicts between roles

## Consolidated Constraints (Phase 4 Input)
1. 零新依赖 (json5 + yaml only)
2. 保持CLI命令兼容
3. 允许内部API破坏性变更
4. 文件大小目标: <400 lines per file
5. 测试覆盖率目标: >=80% for core modules

---

## Task Generation (Phase 4)
**Status**: ✅ Complete

**Generated Artifacts**:
- `IMPL_PLAN.md` - 5-phase implementation plan
- `plan.json` - Machine-readable plan with shared context
- `TODO_LIST.md` - Task checklist with dependency graph
- `IMPL-001.json` through `IMPL-008.json` - 8 executable task definitions

**Phase Summary**:
| Phase | Tasks | Duration | Features |
|-------|-------|----------|----------|
| 1 | IMPL-001, IMPL-002 | 3-4 days | F-004 Error hierarchy + F-008 Test patterns |
| 2 | IMPL-003, IMPL-004 | 4-5 days | F-001 Step-ops decompose + F-003 Backend unify |
| 3 | IMPL-005 | 2-3 days | F-002 CLI registry |
| 4 | IMPL-006, IMPL-007 | 3-4 days | F-005 Type safety + F-006 Immutability |
| 5 | IMPL-008 | 3-4 days | F-007 Test coverage fill |

## N+1 Context
### Decisions
| Decision | Rationale | Revisit? |
|----------|-----------|----------|
| 5-Phase execution order | F-004 foundation, then parallel F-001+F-003, then F-002, then F-005+F-006, finally F-007 | No |
| Barrel re-export for F-001 | Zero-breakage migration pattern | No |
| CommandHandler for F-002 | Per-command testability without new deps | No |

### Deferred
- [ ] Phase 5 UI Design Exploration (skipped — library analysis)
