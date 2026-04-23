import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

const RUN_DDL = `
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, task TEXT, status TEXT NOT NULL,
    context TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT
  )`;

const STEPS_DDL = `
  CREATE TABLE IF NOT EXISTS steps (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_id TEXT NOT NULL,
    agent_id TEXT NOT NULL, step_index INTEGER NOT NULL,
    input_template TEXT DEFAULT '', expects TEXT DEFAULT '',
    status TEXT NOT NULL, output TEXT, created_at TEXT, updated_at TEXT
  )`;

export function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(RUN_DDL);
  db.exec(STEPS_DDL);
  return db;
}

export function createTestRun(
  db: DatabaseSync,
  opts: {
    runId: string;
    workflowId: string;
    status?: string;
    steps?: Array<{ stepId: string; status: string; output?: string | null }>;
  }
) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', ?, ?)"
  ).run(opts.runId, opts.workflowId, "test task", opts.status ?? "running", now, now);

  if (opts.steps) {
    for (let i = 0; i < opts.steps.length; i++) {
      const s = opts.steps[i];
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, step_index, input_template, expects, status, output, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, ?)"
      ).run(crypto.randomUUID(), opts.runId, s.stepId, "test-agent", i, s.status, s.output ?? null, now, now);
    }
  }
}

/**
 * Creates a run with multiple steps in various states.
 * Useful for testing step progression and run lifecycle.
 */
export function createRunWithSteps(
  db: DatabaseSync,
  opts: {
    runId?: string;
    stepCount?: number;
    statuses?: string[];
  }
): { runId: string; stepIds: string[] } {
  const runId = opts.runId ?? `run-${Date.now()}`;
  const stepCount = opts.stepCount ?? 3;
  const now = new Date().toISOString();

  // Insert run record
  db.prepare(
    "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', ?, ?)"
  ).run(runId, "test-workflow", "test task", "running", now, now);

  // Insert steps
  const stepIds: string[] = [];
  for (let i = 0; i < stepCount; i++) {
    const stepId = `step-${i}`;
    const status = opts.statuses?.[i] ?? "pending";
    const stepUuid = crypto.randomUUID();

    db.prepare(
      "INSERT INTO steps (id, run_id, step_id, agent_id, step_index, input_template, expects, status, output, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(stepUuid, runId, stepId, "test-agent", i, `input-${i}`, `expects-${i}`, status, null, now, now);

    stepIds.push(stepId);
  }

  return { runId, stepIds };
}

/**
 * Creates a completed run with all steps marked as done.
 * Returns the runId for convenience.
 */
export function createCompletedRun(db: DatabaseSync, runId?: string): string {
  const id = runId ?? `run-completed-${Date.now()}`;
  const now = new Date().toISOString();

  // Insert run record as completed
  db.prepare(
    "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', ?, ?)"
  ).run(id, "test-workflow", "completed task", "completed", now, now);

  // Insert completed steps
  for (let i = 0; i < 3; i++) {
    const stepUuid = crypto.randomUUID();
    db.prepare(
      "INSERT INTO steps (id, run_id, step_id, agent_id, step_index, input_template, expects, status, output, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(stepUuid, id, `step-${i}`, "test-agent", i, `input-${i}`, `expects-${i}`, "done", `output-${i}`, now, now);
  }

  return id;
}

/**
 * Creates or updates a step with a failed status and optional retry count.
 * Useful for testing retry logic and failure handling.
 */
export function createFailedStep(
  db: DatabaseSync,
  runId: string,
  stepId: string,
  retryCount?: number
): void {
  const now = new Date().toISOString();

  // Check if step exists
  const existing = db.prepare("SELECT id FROM steps WHERE run_id = ? AND step_id = ?").get(runId, stepId) as
    | { id: string }
    | undefined;

  if (existing) {
    // Update existing step
    db.prepare(
      "UPDATE steps SET status = ?, output = ?, updated_at = ? WHERE run_id = ? AND step_id = ?"
    ).run("failed", `Failed after ${retryCount ?? 1} retries`, now, runId, stepId);
  } else {
    // Create new failed step
    const stepUuid = crypto.randomUUID();
    const stepIndex = parseInt(stepId.replace("step-", ""), 10) || 0;

    db.prepare(
      "INSERT INTO steps (id, run_id, step_id, agent_id, step_index, input_template, expects, status, output, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      stepUuid,
      runId,
      stepId,
      "test-agent",
      stepIndex,
      `input-${stepIndex}`,
      `expects-${stepIndex}`,
      "failed",
      `Failed after ${retryCount ?? 1} retries`,
      now,
      now
    );
  }
}
