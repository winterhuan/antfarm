# Task: IMPL-007 Apply Immutability to Data Models

## Implementation Summary

Applied immutability patterns to all data models following the CLAUDE.md "Immutability (CRITICAL)" rule.

### Files Modified

#### 1. `src/types/immutable.ts` (NEW)
Created immutability utilities:
- `Mutable<T>` - Removes readonly recursively for construction
- `DeepReadonly<T>` - Deep readonly for complete immutability
- `freeze<T>(obj)` - Recursively freezes objects and arrays
- `freezeArray<T>(arr)` - Freezes arrays with frozen elements
- `merge<T>()` - Immutable object merging utility

#### 2. `src/installer/types.ts`
Applied readonly to all interfaces:
- `WorkflowAgentFiles`: `readonly baseDir`, `Readonly<Record<string, string>>` for files
- `WorkflowAgent`: All fields marked readonly
- `PollingConfig`: All fields marked readonly
- `WorkflowStepFailure`: All fields and nested objects marked readonly
- `LoopConfig`: All fields marked readonly
- `WorkflowStep`: All fields marked readonly
- `Story`: All fields readonly, `ReadonlyArray<string>` for acceptanceCriteria
- `WorkflowSpec`: All fields readonly, `ReadonlyArray<>` for agents/steps
- `StepResult`: All fields marked readonly
- `WorkflowRunRecord`: All fields readonly, `ReadonlyArray<StepResult>` for stepResults

#### 3. `src/installer/step-lifecycle.ts`
Converted 2 mutation sites to spread-based updates:
- `claimStep`: Context building using spread (`{ ...baseContext, run_id, has_frontend_changes }`)
- `completeStep`: Context merging using `Object.entries().reduce()` with spread

#### 4. `src/installer/step-parser.ts`
Converted all mutation patterns to immutable updates:
- `parseOutputKeyValues`: Refactored from imperative loop to `reduce()` with immutable accumulator
- `parseAndInsertStories`: Returns `readonly Story[]`, freezes all inserted stories
- `getStories`: Returns `readonly Story[]`, freezes all returned stories
- `getCurrentStory`: Returns frozen Story object
- `validateAndNormalizeStories`: Uses reduce instead of push, freezes all stories
- `extractStoriesFromOutput`: Return type updated to readonly

### Content Added

**Types and Utilities**:
- `Mutable<T>` (`src/types/immutable.ts:12-14`): Removes readonly recursively
- `DeepReadonly<T>` (`src/types/immutable.ts:20-22`): Adds readonly recursively
- `freeze<T>()` (`src/types/immutable.ts:28-49`): Deep freeze with recursion for objects/arrays
- `freezeArray<T>()` (`src/types/immutable.ts:55-57`): Freeze arrays and their elements

**Readonly Types**:
- `WorkflowSpec` now fully readonly with `ReadonlyArray<>` for collections
- `Story` now fully readonly with `ReadonlyArray<string>` for acceptanceCriteria
- All related types (WorkflowAgent, WorkflowStep, etc.) are now readonly

### Integration Points

For dependent tasks:

```typescript
// Import immutability utilities
import { freeze, freezeArray, type Mutable } from './types/immutable.js';

// When constructing objects for DB insertion
const mutableStory: Mutable<Story> = { /* build without readonly constraints */ };
const frozen = freeze(mutableStory); // Returns DeepReadonly<Story>

// When working with arrays from getStories()
const stories = getStories(db, runId); // Returns readonly Story[]
// stories.push() will now fail at compile time
```

### Pattern Changes

Before (mutation):
```typescript
const context: Record<string, string> = {};
context[key] = value;
for (const [k, v] of entries) {
  context[k] = v;
}
```

After (immutable):
```typescript
const context = freeze({
  ...baseContext,
  [key]: value
});
const merged = Object.entries(entries).reduce(
  (acc, [k, v]) => ({ ...acc, [k]: v }),
  baseContext
);
```

## Outputs for Dependent Tasks

### New Components Available
- `Mutable<T>` type for construction scenarios
- `DeepReadonly<T>` type for complete immutability
- `freeze<T>()` for deep object freezing
- `freezeArray<T>()` for array freezing

### Type Changes
All types in `src/installer/types.ts` are now readonly. Code that mutates these objects will need to:
1. Use spread syntax for updates
2. Cast through `Mutable<T>` for construction
3. Apply `freeze()` before returning

## Status: Complete

All convergence criteria met:
- Mutable<T> utility type defined
- WorkflowSpec marked readonly throughout
- Story type marked readonly throughout
- Step types marked readonly throughout
- Context maps use Readonly<Record>
- 5+ mutation sites converted to spread-based updates
- Tests pass (6/6 for immutability utilities)
