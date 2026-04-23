# Task: IMPL-002 Create standardized test patterns and utilities

## Implementation Summary

Created comprehensive test utilities in `tests/helpers/` for use across all implementation tasks. These utilities provide consistent, type-safe ways to create test data, intercept CLI output, and manage test database state.

### Files Modified
- `tests/helpers/builders.ts`: 6 builder functions for test data creation
- `tests/helpers/builders.test.ts`: Unit tests for all builder functions (26 tests)
- `tests/helpers/cli-harness.ts`: CLI test harness for process I/O interception
- `tests/helpers/cli-harness.test.ts`: Tests for CLI harness (13 tests)
- `tests/helpers/test-db.ts`: Extended with 3 new fixture functions
- `tests/helpers/test-db.test.ts`: Tests for database fixtures (8 tests)
- `tests/helpers/workspace-fixture.ts`: File system test utility
- `tests/helpers/index.ts`: Barrel export for all utilities

### Content Added

#### Builder Functions (`builders.ts`)
- **buildWorkflowSpec(overrides?: Partial<WorkflowSpec>): WorkflowSpec** - Creates workflow spec with defaults (id='test-workflow', backend='hermes', empty agents/steps arrays)
- **buildWorkflowAgent(overrides?: Partial<WorkflowAgent>): WorkflowAgent** - Creates agent with defaults (id='test-agent', role='coding', workspace baseDir='/tmp/test-workspace')
- **buildWorkflowStep(overrides?: Partial<WorkflowStep>): WorkflowStep** - Creates step with defaults (id='test-step', type='single', max_retries=3)
- **buildStory(overrides?: Partial<Story>): Story** - Creates story with defaults (unique id, runId='run-test-001', status='pending', retryCount=0)
- **buildRunRecord(overrides?: Partial<WorkflowRunRecord>): WorkflowRunRecord** - Creates run record with defaults (status='running', empty stepResults/context)
- **buildBackendSpy(): BackendSpy** - Creates spy backend that captures all method calls (install, uninstall, startRun, stopRun)

Key design: All builders use immutable patterns with deep cloning for nested objects to prevent shared mutable state between test calls.

#### CLI Harness (`cli-harness.ts`)
- **createCliHarness(): CliHarness** - Intercepts process I/O without terminating
  - Captures stdout to string array
  - Captures stderr to string array
  - Captures exit code (number | null) without actually exiting
  - restore() function returns all process methods to original state
  - Uses getter for exitCode to allow updates after harness creation

Key design: Intercept process.exit throws a special error (isExitIntercept=true) that tests can catch, while the exitCode is set via a shared state object.

#### Database Fixtures (`test-db.ts`)
- **createRunWithSteps(db, opts)** - Creates a run with configurable steps
  - Options: runId?, stepCount?, statuses?
  - Returns: { runId, stepIds }
  - Default: 3 steps with 'pending' status
- **createCompletedRun(db, runId?)** - Creates a completed run with all steps marked done
  - Returns: runId string
- **createFailedStep(db, runId, stepId, retryCount?)** - Creates or updates a step to failed status
  - Output includes retry count information

#### Workspace Fixture (`workspace-fixture.ts`)
- **createWorkspaceDir(structure: Record<string, string>): string** - Creates temp dir with files
  - Auto-cleanup on process exit (SIGINT, SIGTERM, exit)
  - Returns absolute path to temp directory

### Integration Points
- All utilities use types from `src/installer/types.ts` and `src/backend/interface.ts`
- Database fixtures use `node:sqlite` DatabaseSync
- Zero new dependencies (node:test + node:assert/strict only)

### Usage Examples

```typescript
// Builder usage
import { buildWorkflowSpec, buildBackendSpy } from './helpers/builders.js';

const spec = buildWorkflowSpec({
  id: 'my-workflow',
  agents: [buildWorkflowAgent({ id: 'agent-1' })]
});

const spy = buildBackendSpy();
await spy.install(spec, '/tmp/source');
assert.equal(spy.installCalls.length, 1);

// CLI harness usage
import { createCliHarness } from './helpers/cli-harness.js';

const harness = createCliHarness();
try {
  someCliFunction();
} catch (e) {
  // process.exit was called
}
assert.equal(harness.exitCode, 42);
assert.ok(harness.stdout.some(s => s.includes('success')));
harness.restore();

// Database fixture usage
import { createTestDb, createRunWithSteps } from './helpers/test-db.js';

const db = createTestDb();
const { runId, stepIds } = createRunWithSteps(db, {
  stepCount: 5,
  statuses: ['done', 'done', 'running', 'pending', 'pending']
});
```

## Status: Complete

All 43 tests pass:
- 26 builder tests
- 13 CLI harness tests
- 8 database fixture tests

Test utilities are ready for use in dependent tasks (F-001 through F-007).
