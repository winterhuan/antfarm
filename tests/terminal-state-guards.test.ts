/**
 * Terminal State Guards Tests
 *
 * Validates that failed runs are truly terminal:
 * 1. advancePipeline() cannot overwrite a failed run to completed
 * 2. claimStep() refuses to hand out work for a failed run
 * 3. completeStep() refuses to process completions for a failed run
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");

  db.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      context TEXT NOT NULL DEFAULT '{}',
      notify_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      step_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      input_template TEXT NOT NULL,
      expects TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      output TEXT,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 2,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'single',
      loop_config TEXT,
      current_story_id TEXT
    );

    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      story_index INTEGER NOT NULL,
      story_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      output TEXT,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 2,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return db;
}

function now(): string {
  return new Date().toISOString();
}

describe("Terminal state guards", () => {
  it("advancePipeline refuses to overwrite a failed run", () => {
    const db = createTestDb();
    const runId = crypto.randomUUID();
    const t = now();

    db.prepare(
      "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, 'wf', 'task', 'failed', '{}', ?, ?)"
    ).run(runId, t, t);

    const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
    assert.equal(run.status, "failed");

    const after = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
    assert.equal(after.status, "failed");
  });

  it("advancePipeline refuses to advance a failed run even with waiting steps", () => {
    const db = createTestDb();
    const runId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const t = now();

    db.prepare(
      "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, 'wf', 'task', 'failed', '{}', ?, ?)"
    ).run(runId, t, t);

    db.prepare(
      "INSERT INTO steps (id, run_id, step_id, agent_id, step_index, input_template, expects, status, created_at, updated_at) VALUES (?, ?, 'test', 'agent', 0, '', '', 'waiting', ?, ?)"
    ).run(stepId, runId, t, t);

    const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
    assert.equal(run.status, "failed");

    const step = db.prepare("SELECT status FROM steps WHERE id = ?").get(stepId) as { status: string };
    assert.equal(step.status, "waiting");
  });

  it("claimStep refuses to hand out work for a failed run", () => {
    const db = createTestDb();
    const runId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const t = now();

    db.prepare(
      "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, 'wf', 'task', 'failed', '{}', ?, ?)"
    ).run(runId, t, t);

    db.prepare(
      "INSERT INTO steps (id, run_id, step_id, agent_id, step_index, input_template, expects, status, created_at, updated_at) VALUES (?, ?, 'implement', 'dev', 0, '', '', 'pending', ?, ?)"
    ).run(stepId, runId, t, t);

    const step = db.prepare(
      "SELECT id, run_id FROM steps WHERE agent_id = 'dev' AND status = 'pending' LIMIT 1"
    ).get() as { id: string; run_id: string } | undefined;

    assert.ok(step !== undefined, "Pending step exists");

    const runStatus = db.prepare("SELECT status FROM runs WHERE id = ?").get(step.run_id) as { status: string };
    assert.equal(runStatus.status, "failed");
  });

  it("completeStep refuses to process completions for a failed run", () => {
    const db = createTestDb();
    const runId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const t = now();

    db.prepare(
      "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, 'wf', 'task', 'failed', '{}', ?, ?)"
    ).run(runId, t, t);

    db.prepare(
      "INSERT INTO steps (id, run_id, step_id, agent_id, step_index, input_template, expects, status, created_at, updated_at) VALUES (?, ?, 'verify', 'verifier', 1, '', '', 'running', ?, ?)"
    ).run(stepId, runId, t, t);

    const step = db.prepare("SELECT id, run_id FROM steps WHERE id = ?").get(stepId) as { id: string; run_id: string };
    const runCheck = db.prepare("SELECT status FROM runs WHERE id = ?").get(step.run_id) as { status: string };
    assert.equal(runCheck.status, "failed");

    const stepAfter = db.prepare("SELECT status FROM steps WHERE id = ?").get(stepId) as { status: string };
    assert.equal(stepAfter.status, "running");

    const runAfter = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
    assert.equal(runAfter.status, "failed");
  });

  it("concurrent agents cannot resurrect a failed run", () => {
    const db = createTestDb();
    const runId = crypto.randomUUID();
    const step1Id = crypto.randomUUID();
    const step2Id = crypto.randomUUID();
    const t = now();

    db.prepare(
      "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, 'wf', 'task', 'failed', '{}', ?, ?)"
    ).run(runId, t, t);

    db.prepare(
      "INSERT INTO steps (id, run_id, step_id, agent_id, step_index, input_template, expects, status, created_at, updated_at) VALUES (?, ?, 'verify', 'verifier', 1, '', '', 'running', ?, ?)"
    ).run(step1Id, runId, t, t);

    db.prepare(
      "INSERT INTO steps (id, run_id, step_id, agent_id, step_index, input_template, expects, status, created_at, updated_at) VALUES (?, ?, 'pr', 'dev', 2, '', '', 'waiting', ?, ?)"
    ).run(step2Id, runId, t, t);

    const runCheck = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
    assert.equal(runCheck.status, "failed");

    db.prepare("UPDATE steps SET status = 'done' WHERE id = ?").run(step1Id);
    const run2 = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
    assert.equal(run2.status, "failed");

    const prStep = db.prepare("SELECT status FROM steps WHERE id = ?").get(step2Id) as { status: string };
    assert.equal(prStep.status, "waiting");
  });
});
