# Cross-Cutting Architecture Decisions: System Architect

## Core Data Models

### Step Entity

| Field | Type | Constraints |
|-------|------|-------------|
| id | `string` (UUID) | PK, auto-generated |
| step_id | `string` | NOT NULL, unique per run |
| run_id | `string` (UUID) | FK -> runs.id |
| agent_id | `string` | NOT NULL |
| step_index | `number` | NOT NULL, execution order |
| type | `"single" \| "loop"` | NOT NULL, default "single" |
| status | `StepStatus` | NOT NULL |
| input_template | `string` | NOT NULL, contains `{{key}}` placeholders |
| output | `string \| null` | nullable |
| loop_config | `LoopConfig \| null` | JSON string |
| current_story_id | `string \| null` | FK -> stories.id, only for loop steps |
| retry_count | `number` | NOT NULL, default 0 |
| max_retries | `number` | NOT NULL, default 2 |
| abandoned_count | `number` | NOT NULL, default 0, separate from retry_count |

### Story Entity

| Field | Type | Constraints |
|-------|------|-------------|
| id | `string` (UUID) | PK |
| run_id | `string` (UUID) | FK -> runs.id |
| story_index | `number` | NOT NULL, execution order |
| story_id | `string` | NOT NULL, unique per run |
| title | `string` | NOT NULL |
| description | `string` | NOT NULL |
| acceptance_criteria | `string[]` | NOT NULL, min length 1, JSON-serialized |
| status | `"pending" \| "running" \| "done" \| "failed"` | NOT NULL |
| retry_count | `number` | NOT NULL, default 0 |
| max_retries | `number` | NOT NULL, default 2 |

### Run Entity

| Field | Type | Constraints |
|-------|------|-------------|
| id | `string` (UUID) | PK |
| run_number | `number \| null` | unique if non-null |
| workflow_id | `string` | NOT NULL |
| task | `string` | NOT NULL |
| status | `"running" \| "failed" \| "cancelled" \| "completed"` | NOT NULL |
| context | `string` (JSON) | NOT NULL, default "{}" |

### WorkflowSpec

| Field | Type | Constraints |
|-------|------|-------------|
| id | `string` | NOT NULL |
| agents | `WorkflowAgent[]` | NOT NULL, min 1 |
| steps | `WorkflowStep[]` | NOT NULL, min 1 |
| polling | `PollingConfig` | optional |
| defaultBackend | `BackendType` | optional |

## Step Lifecycle State Machine

```
                    +-----------------------------------------+
                    |         (created by runWorkflow)        |
                    v                                         |
              +-----------+                                  |
              |  waiting  |------- advancePipeline() ------->|
              +-----+-----+                                  |
                    | claimStep()                             |
                    v                                         |
              +-----------+    abandon (timeout)    +--------+---+
         +--->|  pending  |<----------------------  |  running   |--+
         |    +-----------+                          +---+----+---+  |
         |         |                                     |    |      |
         |         | claimStep()                         |    |      | completeStep()
         |         +------------------------------------>|    |      |
         |                                               |    v      |
         |         retry < max                   +--------+---+   |
         |         +---------------------------->|    done    |--> advancePipeline()
         |         |                             +------------+
         |         | abandon < MAX_ABANDON
         |         |
         |    retry > max OR abandon > MAX_ABANDON
         |         |
         |         v
         |    +-----------+
         +----|  failed   |---- run also set to failed
              +-----------+
```

**Transition Table**:

| Current | Event | Guard | Next | Side Effects |
|---------|-------|-------|------|--------------|
| waiting | advancePipeline | run active, no running steps | pending | emit step.pending |
| pending | claimStep (single) | no earlier unfinished steps | running | emit step.running |
| pending | claimStep (loop) | stories exist, next found | running | set current_story_id |
| pending | claimStep (loop) | no stories produced | failed | fail run |
| running | completeStep (single) | -- | done | merge context, emit step.done |
| running | completeStep (loop, verify_each) | -- | running | mark story done |
| running | completeStep (loop, no more) | all done | done | advancePipeline |
| running | completeStep (loop, failed) | failed exist | failed | fail run |
| running | failStep | retry_count <= max | pending | increment retry_count |
| running | failStep | retry_count > max | failed | fail run, emit run.failed |
| running | abandonment | abandoned < MAX_ABANDON (5) | pending | increment abandoned_count |
| running | abandonment | abandoned >= MAX_ABANDON | failed | fail run |

**Key constraints**: Terminal states (`done`, `failed`) MUST NOT transition except via explicit `resume`. Loop steps track per-story retry separately. Abandoned steps use `abandoned_count` (NOT `retry_count`).

## Error Handling Strategy

| Category | Severity | Recovery | Examples |
|----------|----------|----------|----------|
| Transient | Low | Automatic retry | Network timeout, subprocess crash |
| Validation | Medium | Immediate fail with message | Missing template keys, invalid STORIES_JSON |
| Exhaustion | High | Fail run + escalate | Max retries exceeded, abandon threshold |
| Configuration | High | Fail with guidance | Invalid backend type, missing config |
| Infrastructure | Critical | Fail + notify | Profile creation failure, disk full |

## Observability Requirements

Existing events: 13 types (step.pending, step.running, step.done, step.failed, step.timeout, story.started, story.done, story.failed, story.retry, run.completed, run.failed, pipeline.advanced).

Recommended additions:
- **Metrics**: step_duration_seconds (histogram), step_retry_total (counter), abandoned_steps_total (counter), run_duration_seconds (histogram)
- **Structured logging**: All logger calls SHOULD include runId/stepId context
- **Health checks**: Dashboard daemon PID, medic watchdog, abandoned-step cleanup (5 min)

## Dependency Graph & Execution Order

```
F-004 (Error Hierarchy) -- foundation for all others
  |
  +---> F-001 (step-ops decompose) -- uses AntfarmError subclasses
  +---> F-002 (CLI registry) -- uses CliError
  +---> F-003 (Backend unify) -- uses BackendError
  |
F-001 (step-ops decompose)
  |
  +---> F-005 (Type safety) -- typed interfaces for decomposed modules
  +---> F-006 (Immutability) -- readonly on Step/Story types
  +---> F-007 (Unit tests) -- per-module test files
```

**Recommended execution order**: F-004 first, then F-001 + F-003 in parallel, then F-002, then F-005 + F-006, finally F-007 + F-008.
