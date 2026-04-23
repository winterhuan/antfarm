# F-001: step-ops-decompose — Test Strategist Analysis

## Risk: Critical (1103 lines, zero unit tests, central to workflow execution)

## Pre-Decomposition Requirement

Tests MUST be written against the current monolith before decomposition begins. These serve as regression safety net.

## 1. Step Parser Tests (`step-parser.test.ts`) — 11 cases

`parseOutputKeyValues` is a pure function — highest-value target.

- Single KEY: value pair
- Multiple KEY: value pairs
- Multi-line value accumulation
- KEY with empty value
- Case normalization (keys lowercased)
- STORIES_JSON key is skipped
- Whitespace trimming
- No keys returns empty object
- Blank lines between pairs
- Value containing colon characters
- Very long output (1000+ lines) — performance

**Testability**: HIGH. Pure function, no dependencies.

## 2. Step Lifecycle Tests (`step-lifecycle.test.ts`) — 15 cases

`claimStep`:
- Claims pending step (status -> running)
- Returns null when no pending step
- Returns null when step already claimed
- Sets updated_at timestamp
- Returns correct step data

`completeStep`:
- Completes running step (status -> done)
- Stores output text
- Rejects non-running step completion
- Handles empty output

`failStep`:
- Fails running step (status -> failed)
- Retry logic: retry_count < max → pending
- Exhausted retries: final failed + escalation
- Records retry count increment

**Testability**: MEDIUM. Requires database fixture.

## 3. Step Template Tests (`step-template.test.ts`) — 7 cases

- Simple variable substitution
- Nested context variables
- Missing variable → StepError (after F-004)
- No variables returns original
- HTML/special characters NOT escaped
- Circular reference guard
- Multi-variable mixed types

**Testability**: HIGH.

## 4. Step Runner Tests (`step-runner.test.ts`) — 8 cases

- Single step execution
- Loop step story iteration
- Loop completion when all stories done
- freshSession flag respected
- Story failure triggers retry
- verifyStep after each story when verifyEach=true
- Agent spawn with correct parameters

**Testability**: LOW-MEDIUM. Must mock agent spawn.

## 5. Step Utils Tests (`step-utils.test.ts`) — 4 cases

- Hash function consistency
- Hash empty input
- Temp directory creation/cleanup
- Path manipulation

**Total: 45 test cases across 5 test files.**

## Decomposition Test Sequence

```
Phase 1: Write tests against current monolith (RED)
Phase 2: Decompose step-ops.ts (GREEN) — all tests MUST pass
Phase 3: Add module-specific edge case tests
```
