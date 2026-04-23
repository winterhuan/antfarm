/**
 * Step Lifecycle Module
 *
 * Core step lifecycle operations: peek, claim, complete, fail, advance.
 * Approximately 350 lines.
 */

import type { DatabaseSync } from "node:sqlite";
import type { LoopConfig, Story } from "./types.js";
import {
  parseOutputKeyValues,
  parseAndInsertStories,
  getStories,
  getCurrentStory,
  formatStoryForTemplate,
  formatCompletedStories,
} from "./step-parser.js";
import {
  resolveTemplate,
  findMissingTemplateKeys,
  computeHasFrontendChanges,
} from "./step-template.js";
import {
  checkLoopContinuation,
  handleVerifyEachCompletion,
} from "./step-loop.js";
import { getWorkflowId } from "./step-utils.js";
import { emitEvent } from "./events.js";
import { logger } from "../lib/logger.js";

export type PeekResult = "HAS_WORK" | "NO_WORK";

export interface ClaimResult {
  found: boolean;
  stepId?: string;
  runId?: string;
  resolvedInput?: string;
}

export interface CompleteResult {
  advanced: boolean;
  runCompleted: boolean;
}

export interface FailResult {
  retrying: boolean;
  runFailed: boolean;
}

const CLEANUP_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes
let lastCleanupTime = 0;

/**
 * Lightweight check: does this agent have any pending/waiting steps in active runs?
 * Returns "HAS_WORK" if any pending/waiting steps exist, "NO_WORK" otherwise.
 */
export function peekStep(db: DatabaseSync, agentId: string): PeekResult {
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM steps s
     JOIN runs r ON r.id = s.run_id
     WHERE s.agent_id = ? AND s.status IN ('pending', 'waiting')
       AND r.status = 'running'`
  ).get(agentId) as { cnt: number };
  return row.cnt > 0 ? "HAS_WORK" : "NO_WORK";
}

/**
 * Find and claim a pending step for an agent, returning the resolved input.
 */
export function claimStep(
  db: DatabaseSync,
  agentId: string,
  runId: string
): ClaimResult {
  // Throttle cleanup: run at most once every 5 minutes
  const now = Date.now();
  if (now - lastCleanupTime >= CLEANUP_THROTTLE_MS) {
    cleanupAbandonedSteps(db, runId);
    lastCleanupTime = now;
  }

  const step = db.prepare(
    `SELECT s.id, s.step_id, s.run_id, s.input_template, s.type, s.loop_config, s.step_index
     FROM steps s
     JOIN runs r ON r.id = s.run_id
     WHERE s.agent_id = ? AND s.status = 'pending'
       AND r.status NOT IN ('failed', 'cancelled')
       AND NOT EXISTS (
         SELECT 1 FROM steps prev
         WHERE prev.run_id = s.run_id
           AND prev.step_index < s.step_index
           AND prev.status NOT IN ('done', 'skipped')
       )
    ORDER BY s.step_index ASC, s.step_id ASC
     LIMIT 1`
  ).get(agentId) as {
    id: string;
    step_id: string;
    run_id: string;
    input_template: string;
    type: string;
    loop_config: string | null;
    step_index: number;
  } | undefined;

  if (!step) return { found: false };

  // Guard: don't claim work for a failed run
  const runStatus = db.prepare("SELECT status FROM runs WHERE id = ?").get(step.run_id) as { status: string } | undefined;
  if (runStatus?.status === "failed") return { found: false };

  // Get run context
  const run = db.prepare("SELECT context FROM runs WHERE id = ?").get(step.run_id) as { context: string } | undefined;
  const context: Record<string, string> = run ? JSON.parse(run.context) : {};

  // Always inject run_id so templates can use {{run_id}}
  context["run_id"] = step.run_id;
  context["has_frontend_changes"] = "false";

  // Single step: existing logic
  db.prepare(
    "UPDATE steps SET status = 'running', updated_at = datetime('now') WHERE id = ? AND status = 'pending'"
  ).run(step.id);

  emitEvent({
    ts: new Date().toISOString(),
    event: "step.running",
    runId: step.run_id,
    workflowId: getWorkflowId(db, step.run_id),
    stepId: step.step_id,
    agentId,
  });

  logger.info(`Step claimed by ${agentId}`, { runId: step.run_id, stepId: step.step_id });

  const missingKeys = findMissingTemplateKeys(step.input_template, context);
  if (missingKeys.length > 0) {
    failStepWithMissingInputs(db, step.id, step.step_id, step.run_id, missingKeys);
    return { found: false };
  }

  const resolvedInput = resolveTemplate(step.input_template, context);

  return {
    found: true,
    stepId: step.id,
    runId: step.run_id,
    resolvedInput,
  };
}

/**
 * Complete a step: save output, merge context, advance pipeline.
 */
export function completeStep(
  db: DatabaseSync,
  stepId: string,
  output: string
): CompleteResult {
  const step = db.prepare(
    "SELECT id, run_id, step_id, step_index, type, loop_config, current_story_id FROM steps WHERE id = ?"
  ).get(stepId) as {
    id: string;
    run_id: string;
    step_id: string;
    step_index: number;
    type: string;
    loop_config: string | null;
    current_story_id: string | null;
  } | undefined;

  if (!step) throw new Error(`Step not found: ${stepId}`);

  // Guard: don't process completions for failed/cancelled runs
  const runCheck = db.prepare("SELECT status FROM runs WHERE id = ?").get(step.run_id) as { status: string } | undefined;
  if (runCheck?.status === "failed" || runCheck?.status === "cancelled") {
    return { advanced: false, runCompleted: false };
  }

  // Merge KEY: value lines into run context
  const run = db.prepare("SELECT context FROM runs WHERE id = ?").get(step.run_id) as { context: string };
  const context: Record<string, string> = JSON.parse(run.context);

  const parsed = parseOutputKeyValues(output);
  for (const [key, value] of Object.entries(parsed)) {
    context[key] = value;
  }

  db.prepare(
    "UPDATE runs SET context = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(context), step.run_id);

  // Parse STORIES_JSON from output
  parseAndInsertStories(db, step.run_id, output);

  // Loop step completion
  if (step.type === "loop" && step.current_story_id) {
    // Mark current story done
    db.prepare(
      "UPDATE stories SET status = 'done', output = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(output, step.current_story_id);

    // Clear current_story_id, save output
    db.prepare(
      "UPDATE steps SET current_story_id = NULL, output = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(output, step.id);

    return checkLoopContinuation(db, step.run_id, step.id);
  }

  // Single step: mark done and advance
  db.prepare(
    "UPDATE steps SET status = 'done', output = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(output, stepId);

  emitEvent({
    ts: new Date().toISOString(),
    event: "step.done",
    runId: step.run_id,
    workflowId: getWorkflowId(db, step.run_id),
    stepId: step.step_id,
  });

  logger.info(`Step completed: ${step.step_id}`, { runId: step.run_id, stepId: step.step_id });

  return advancePipeline(db, step.run_id);
}

/**
 * Fail a step, with retry logic. For loop steps, applies per-story retry.
 */
export function failStep(
  db: DatabaseSync,
  stepId: string,
  error: string
): FailResult {
  const step = db.prepare(
    "SELECT run_id, step_id, retry_count, max_retries, type, current_story_id FROM steps WHERE id = ?"
  ).get(stepId) as {
    run_id: string;
    step_id: string;
    retry_count: number;
    max_retries: number;
    type: string;
    current_story_id: string | null;
  } | undefined;

  if (!step) throw new Error(`Step not found: ${stepId}`);

  // Loop step failure — per-story retry
  if (step.type === "loop" && step.current_story_id) {
    const story = db.prepare(
      "SELECT id, retry_count, max_retries FROM stories WHERE id = ?"
    ).get(step.current_story_id) as { id: string; retry_count: number; max_retries: number } | undefined;

    if (story) {
      const newRetry = story.retry_count + 1;
      if (newRetry > story.max_retries) {
        // Story retries exhausted
        db.prepare("UPDATE stories SET status = 'failed', retry_count = ?, updated_at = datetime('now') WHERE id = ?").run(newRetry, story.id);
        db.prepare("UPDATE steps SET status = 'failed', output = ?, current_story_id = NULL, updated_at = datetime('now') WHERE id = ?").run(error, stepId);
        db.prepare("UPDATE runs SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(step.run_id);
        return { retrying: false, runFailed: true };
      }

      // Retry the story
      db.prepare("UPDATE stories SET status = 'pending', retry_count = ?, updated_at = datetime('now') WHERE id = ?").run(newRetry, story.id);
      db.prepare("UPDATE steps SET status = 'pending', current_story_id = NULL, updated_at = datetime('now') WHERE id = ?").run(stepId);
      return { retrying: true, runFailed: false };
    }
  }

  // Single step: existing logic
  const newRetryCount = step.retry_count + 1;

  if (newRetryCount > step.max_retries) {
    db.prepare(
      "UPDATE steps SET status = 'failed', output = ?, retry_count = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(error, newRetryCount, stepId);
    db.prepare(
      "UPDATE runs SET status = 'failed', updated_at = datetime('now') WHERE id = ?"
    ).run(step.run_id);
    return { retrying: false, runFailed: true };
  } else {
    db.prepare(
      "UPDATE steps SET status = 'pending', retry_count = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newRetryCount, stepId);
    return { retrying: true, runFailed: false };
  }
}

/**
 * Advance the pipeline: find the next waiting step and make it pending, or complete the run.
 */
export function advancePipeline(
  db: DatabaseSync,
  runId: string
): CompleteResult {
  // Guard: don't advance or complete a run that's already failed/cancelled
  const runStatus = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | undefined;
  if (runStatus?.status === "failed" || runStatus?.status === "cancelled") {
    return { advanced: false, runCompleted: false };
  }

  const runningStep = db.prepare(
    "SELECT id FROM steps WHERE run_id = ? AND status = 'running' LIMIT 1"
  ).get(runId) as { id: string } | undefined;
  if (runningStep) {
    return { advanced: false, runCompleted: false };
  }

  const next = db.prepare(
    "SELECT id, step_id FROM steps WHERE run_id = ? AND status = 'waiting' ORDER BY step_index ASC LIMIT 1"
  ).get(runId) as { id: string; step_id: string } | undefined;

  const incomplete = db.prepare(
    "SELECT id FROM steps WHERE run_id = ? AND status IN ('failed', 'pending', 'running') LIMIT 1"
  ).get(runId) as { id: string } | undefined;

  if (!next && incomplete) {
    return { advanced: false, runCompleted: false };
  }

  if (next) {
    db.prepare(
      "UPDATE steps SET status = 'pending', updated_at = datetime('now') WHERE id = ?"
    ).run(next.id);
    emitEvent({
      ts: new Date().toISOString(),
      event: "pipeline.advanced",
      runId,
      workflowId: getWorkflowId(db, runId),
      stepId: next.step_id,
    });
    return { advanced: true, runCompleted: false };
  } else {
    db.prepare(
      "UPDATE runs SET status = 'completed', updated_at = datetime('now') WHERE id = ?"
    ).run(runId);
    emitEvent({
      ts: new Date().toISOString(),
      event: "run.completed",
      runId,
      workflowId: getWorkflowId(db, runId),
    });
    logger.info("Run completed", { runId });
    return { advanced: false, runCompleted: true };
  }
}

/**
 * Find steps that have been "running" for too long and reset them to pending.
 * This catches cases where an agent claimed a step but never completed/failed it.
 */
export function cleanupAbandonedSteps(db: DatabaseSync, runId: string): void {
  const ABANDONED_THRESHOLD_MS = 300_000; // 5 minutes for tests

  // Find running steps that haven't been updated recently
  const abandonedSteps = db.prepare(
    "SELECT id, step_id, run_id, retry_count, max_retries, type, current_story_id, loop_config, abandoned_count FROM steps WHERE status = 'running' AND run_id = ? AND (julianday('now') - julianday(updated_at)) * 86400000 > ?"
  ).all(runId, ABANDONED_THRESHOLD_MS) as Array<{
    id: string;
    step_id: string;
    run_id: string;
    retry_count: number;
    max_retries: number;
    type: string;
    current_story_id: string | null;
    loop_config: string | null;
    abandoned_count: number;
  }>;

  for (const step of abandonedSteps) {
    // Loop steps: apply per-story retry, not per-step retry
    if (step.type === "loop" && step.current_story_id) {
      const story = db.prepare(
        "SELECT id, retry_count, max_retries FROM stories WHERE id = ?"
      ).get(step.current_story_id) as { id: string; retry_count: number; max_retries: number } | undefined;

      if (story) {
        const newRetry = story.retry_count + 1;
        if (newRetry > story.max_retries) {
          db.prepare("UPDATE stories SET status = 'failed', retry_count = ?, updated_at = datetime('now') WHERE id = ?").run(newRetry, story.id);
          db.prepare("UPDATE steps SET status = 'failed', output = 'Story abandoned and retries exhausted', current_story_id = NULL, updated_at = datetime('now') WHERE id = ?").run(step.id);
          db.prepare("UPDATE runs SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(step.run_id);
        } else {
          db.prepare("UPDATE stories SET status = 'pending', retry_count = ?, updated_at = datetime('now') WHERE id = ?").run(newRetry, story.id);
          db.prepare("UPDATE steps SET status = 'pending', current_story_id = NULL, updated_at = datetime('now') WHERE id = ?").run(step.id);
        }
        continue;
      }
    }

    // Single steps: use abandoned_count
    const newAbandonCount = (step.abandoned_count ?? 0) + 1;
    const MAX_ABANDON_RESETS = 5;

    if (newAbandonCount >= MAX_ABANDON_RESETS) {
      db.prepare(
        "UPDATE steps SET status = 'failed', output = 'Agent abandoned step without completing (' || ? || ' times)', abandoned_count = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(newAbandonCount, newAbandonCount, step.id);
      db.prepare(
        "UPDATE runs SET status = 'failed', updated_at = datetime('now') WHERE id = ?"
      ).run(step.run_id);
    } else {
      db.prepare(
        "UPDATE steps SET status = 'pending', abandoned_count = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(newAbandonCount, step.id);
    }
  }

  // Reset running stories that are abandoned
  db.prepare(
    "UPDATE stories SET status = 'pending', updated_at = datetime('now') WHERE run_id = ? AND status = 'running' AND (julianday('now') - julianday(updated_at)) * 86400000 > ?"
  ).run(runId, ABANDONED_THRESHOLD_MS);
}

/**
 * Fail a step with missing inputs.
 */
function failStepWithMissingInputs(
  db: DatabaseSync,
  stepDbId: string,
  stepPublicId: string,
  runId: string,
  missingKeys: string[]
): void {
  const message = `Step input is not ready: missing required template key(s) ${missingKeys.join(", ")}`;

  db.prepare(
    "UPDATE steps SET status = 'failed', output = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(message, stepDbId);
  db.prepare("UPDATE runs SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(runId);

  emitEvent({
    ts: new Date().toISOString(),
    event: "step.failed",
    runId,
    workflowId: getWorkflowId(db, runId),
    stepId: stepPublicId,
    detail: message,
  });

  emitEvent({
    ts: new Date().toISOString(),
    event: "run.failed",
    runId,
    workflowId: getWorkflowId(db, runId),
    detail: message,
  });
}
