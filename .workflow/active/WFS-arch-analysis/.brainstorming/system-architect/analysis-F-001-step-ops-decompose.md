# Feature F-001: step-ops-decompose — System Architect Analysis

## Current State

step-ops.ts (1103 lines) mixes 5 distinct responsibilities:

1. **Output parsing** (lines 24-270): `parseOutputKeyValues`, `parseAndInsertStories`, `getStories`, `getCurrentStory`
2. **Template resolution** (lines 85-111, 392-404): `resolveTemplate`, `findMissingTemplateKeys`, `computeHasFrontendChanges`
3. **Step lifecycle** (lines 456-959): `claimStep`, `completeStep`, `failStep`, `advancePipeline`, cleanup
4. **Story lifecycle** (lines 198-262, interleaved): Story parsing, formatting, retry logic
5. **Utilities** (lines 60-148, 961-1030): DB helpers, progress files, escalation

## Proposed Module Structure

### `src/installer/step-parser.ts` (~200 lines)
- `parseOutputKeyValues(output)` — pure function
- `parseAndInsertStories(output, runId)` — DB write + JSON parsing
- `getStories(runId)` — DB read
- `getCurrentStory(stepId)` — DB read
- `formatStoryForTemplate(story)` — pure formatting
- `formatCompletedStories(stories)` — pure formatting

Clean boundary: receives strings, returns parsed structures. Only `parseAndInsertStories` touches DB.

### `src/installer/step-template.ts` (~150 lines)
- `resolveTemplate(template, context)` — pure function
- `findMissingTemplateKeys(template, context)` — pure function
- `computeHasFrontendChanges(repo, branch)` — git subprocess call

Entirely pure (except `computeHasFrontendChanges`). Zero DB dependencies.

### `src/installer/step-lifecycle.ts` (~350 lines)
- `peekStep(agentId)` — lightweight DB query
- `claimStep(agentId)` — DB read/write, calls template + parser
- `completeStep(stepId, output)` — DB read/write, story lifecycle
- `failStep(stepId, error)` — DB read/write, retry logic
- `advancePipeline(runId)` — DB read/write, pipeline advancement
- `cleanupAbandonedSteps()` — DB read/write, throttled cleanup

Core module. Imports from step-parser, step-template, step-loop, step-utils.

### `src/installer/step-loop.ts` (~200 lines)
- `handleVerifyEachCompletion(step, loopStepId, output, context)`
- `checkLoopContinuation(runId, loopStepId)`
- Story retry logic extracted from `failStep` and `cleanupAbandonedSteps`

Separates loop-specific complexity from the single-step path.

### `src/installer/step-utils.ts` (~100 lines)
- `getWorkflowId(runId)`, `scheduleRunCronTeardown(runId)`
- `readProgressFile(runId)`, `archiveRunProgress(runId)`
- `getAgentWorkspacePath(agentId)`, `failStepWithMissingInputs(...)`
- Escalation functions

## Cross-Module Dependencies

```
step-lifecycle.ts
  +---> step-parser.ts (parseOutputKeyValues, parseAndInsertStories)
  +---> step-template.ts (resolveTemplate, findMissingTemplateKeys)
  +---> step-loop.ts (handleVerifyEachCompletion, checkLoopContinuation)
  +---> step-utils.ts (getWorkflowId, scheduleRunCronTeardown, etc.)
```

## Migration Strategy

1. Create all 5 new files with functions extracted from step-ops.ts
2. Update step-ops.ts to barrel re-export: `export { claimStep } from './step-lifecycle.js'`
3. Update imports across codebase (cli.ts, tests, etc.)
4. Verify all existing tests pass
5. Remove barrel file once all consumers import directly

The barrel re-export ensures zero breakage during migration. Consumers update incrementally.

## Risk: Circular Dependency

`cleanupAbandonedSteps` calls `advancePipeline`, and `claimStep` calls `cleanupAbandonedSteps`. This is a self-contained cycle within step-lifecycle.ts, which is acceptable. The loop-specific logic in step-loop.ts breaks the larger conceptual cycle.
