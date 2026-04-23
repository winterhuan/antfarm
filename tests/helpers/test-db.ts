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
