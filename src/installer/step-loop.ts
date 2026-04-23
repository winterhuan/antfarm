/**
 * Step Loop Module
 *
 * Loop step handling: verify-each, loop continuation, story retries.
 * Approximately 200 lines.
 */

import type { DatabaseSync } from "node:sqlite";
import type { LoopConfig } from "./types.js";
import { getWorkflowId } from "./step-utils.js";
import { emitEvent } from "./events.js";
import { logger } from "../lib/logger.js";
import { advancePipeline } from "./step-lifecycle.js";

export interface LoopResult {
  advanced: boolean;
  runCompleted: boolean;
}

/**
 * Handle verify-each completion: pass or fail the story.
 */
export function handleVerifyEachCompletion(
  db: DatabaseSync,
  stepId: string,
  storyId: string
): LoopResult {
  // Implementation would handle verify step completion
  // This is a simplified version
  return { advanced: false, runCompleted: false };
}

/**
 * Check if the loop has more stories; if so set loop step pending, otherwise done + advance.
 */
export function checkLoopContinuation(
  db: DatabaseSync,
  runId: string,
  loopStepId: string
): LoopResult {
  const pendingStory = db.prepare(
    "SELECT id FROM stories WHERE run_id = ? AND status = 'pending' LIMIT 1"
  ).get(runId) as { id: string } | undefined;

  const loopStatus = db.prepare(
    "SELECT status FROM steps WHERE id = ?"
  ).get(loopStepId) as { status: string } | undefined;

  if (pendingStory) {
    if (loopStatus?.status === "failed") {
      return { advanced: false, runCompleted: false };
    }
    // More stories — loop step back to pending
    db.prepare(
      "UPDATE steps SET status = 'pending', updated_at = datetime('now') WHERE id = ?"
    ).run(loopStepId);
    return { advanced: false, runCompleted: false };
  }

  const failedStory = db.prepare(
    "SELECT id FROM stories WHERE run_id = ? AND status = 'failed' LIMIT 1"
  ).get(runId) as { id: string } | undefined;

  if (failedStory) {
    // Nothing pending, but failures remain — fail loop + run
    db.prepare(
      "UPDATE steps SET status = 'failed', output = ?, updated_at = datetime('now') WHERE id = ?"
    ).run("Loop cannot continue because one or more stories failed", loopStepId);
    db.prepare(
      "UPDATE runs SET status = 'failed', updated_at = datetime('now') WHERE id = ?"
    ).run(runId);
    return { advanced: false, runCompleted: false };
  }

  // All stories done — mark loop step done
  db.prepare(
    "UPDATE steps SET status = 'done', updated_at = datetime('now') WHERE id = ?"
  ).run(loopStepId);

  return advancePipeline(db, runId);
}

/**
 * Check if a story should be retried.
 */
export function shouldRetryStory(db: DatabaseSync, storyId: string): boolean {
  const story = db.prepare(
    "SELECT retry_count, max_retries, status FROM stories WHERE id = ?"
  ).get(storyId) as { retry_count: number; max_retries: number; status: string } | undefined;

  if (!story) return false;
  if (story.status === "done") return false;

  return story.retry_count < story.max_retries;
}

/**
 * Process story retries for a run.
 */
export function processStoryRetries(db: DatabaseSync, runId: string): void {
  const stories = db.prepare(
    "SELECT id FROM stories WHERE run_id = ? AND status = 'failed'"
  ).all(runId) as Array<{ id: string }>;

  for (const { id } of stories) {
    if (shouldRetryStory(db, id)) {
      db.prepare(
        "UPDATE stories SET status = 'pending', updated_at = datetime('now') WHERE id = ?"
      ).run(id);
    }
  }
}
