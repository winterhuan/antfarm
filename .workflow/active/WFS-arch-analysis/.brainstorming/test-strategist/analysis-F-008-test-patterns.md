# F-008: test-patterns — Test Strategist Analysis

## Required Pattern Additions

### 1. Test Data Builders (`tests/helpers/builders.ts`)

```typescript
buildWorkflowSpec(overrides?)  // defaults: id='test-wf', 1 agent, 1 step
buildWorkflowAgent(overrides?) // defaults: id='test-agent', role='coding'
buildWorkflowStep(overrides?)  // defaults: id='test-step', input='do work'
buildStory(overrides?)        // defaults: id='story-1', status='pending'
buildRunRecord(overrides?)    // defaults: id='run-1', status='running'
buildBackendSpy(opts?)        // enhancement of createSpyBackend
```

Design rules: each builder accepts `Partial<T>`, returns exact type, no shared mutable state.

### 2. CLI Test Harness (`tests/helpers/cli-harness.ts`)

Intercepts `process.stdout.write`, `process.stderr.write`, `process.exit`. Restores originals in cleanup.

### 3. Database Fixture Extensions (extend `tests/helpers/test-db.ts`)

- `createRunWithSteps(db, opts)` with configurable step states
- `createCompletedRun(db, runId)` for status tests
- `createFailedStep(db, runId, stepId, retryCount)` for retry tests

### 4. Workspace Fixture (`tests/helpers/workspace-fixture.ts`)

- `createWorkspaceDir(structure: Record<string, string>)` for filesystem tests

## Test Naming Convention

```
GOOD:  it('returns null when no pending step exists')
GOOD:  it('throws StepError when step claim fails after max retries')
BAD:   it('test claim step')
BAD:   it('works')
```

## Package.json Additions

```
"test:coverage": "npx tsx --test --coverage src/**/*.test.ts tests/**/*.test.ts"
"test:watch": "npx tsx --test --watch src/**/*.test.ts"
```
