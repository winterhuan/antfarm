/**
 * Step Utils Test Suite (10 tests)
 *
 * Tests for step-utils.ts module
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { getDb, initDb, closeDb } from "../db.js";
import {
  getWorkflowId,
  scheduleRunCronTeardown,
  readProgressFile,
  archiveRunProgress,
} from "./step-utils.js";
import fs from "node:fs";

let testDbCounter = 0;

function getTestDbPath(): string {
  return `/tmp/antfarm-step-utils-test-${testDbCounter++}.db`;
}

describe("step-utils", () => {
  let currentTestDbPath: string;
  let originalDbPath: string | undefined;

  beforeEach(() => {
    originalDbPath = process.env.ANTFARM_DB_PATH;
    currentTestDbPath = getTestDbPath();
    process.env.ANTFARM_DB_PATH = currentTestDbPath;
    initDb(currentTestDbPath);
  });

  afterEach(() => {
    closeDb();
    if (originalDbPath === undefined) {
      delete process.env.ANTFARM_DB_PATH;
    } else {
      process.env.ANTFARM_DB_PATH = originalDbPath;
    }
    try {
      fs.unlinkSync(currentTestDbPath);
      fs.unlinkSync(currentTestDbPath + "-shm");
      fs.unlinkSync(currentTestDbPath + "-wal");
    } catch { /* ignore */ }
  });

  // ============================================================================
  // getWorkflowId (4 tests)
  // ============================================================================
  describe("getWorkflowId", () => {
    it("should extract workflow ID from run ID", () => {
      const db = getDb();
      const runId = "wf-123-run-456";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-123", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const workflowId = getWorkflowId(db, runId);
      assert.strictEqual(workflowId, "wf-123");
    });

    it("should return undefined for non-existent run", () => {
      const db = getDb();
      const workflowId = getWorkflowId(db, "non-existent-run");
      assert.strictEqual(workflowId, undefined);
    });

    it("should handle run ID with multiple dashes", () => {
      const db = getDb();
      const runId = "my-workflow-123-run-456-789";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "my-workflow-123", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const workflowId = getWorkflowId(db, runId);
      assert.strictEqual(workflowId, "my-workflow-123");
    });

    it("should handle simple run ID", () => {
      const db = getDb();
      const runId = "workflow-run-001";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "workflow", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const workflowId = getWorkflowId(db, runId);
      assert.strictEqual(workflowId, "workflow");
    });
  });

  // ============================================================================
  // readProgressFile (3 tests)
  // ============================================================================
  describe("readProgressFile", () => {
    it("should return null when progress file does not exist", () => {
      const result = readProgressFile("non-existent-run");
      assert.strictEqual(result, null);
    });

    it("should return null for any run ID", () => {
      const result = readProgressFile("some-run-id");
      assert.strictEqual(result, null);
    });
  });

  // ============================================================================
  // scheduleRunCronTeardown (3 tests)
  // ============================================================================
  describe("scheduleRunCronTeardown", () => {
    it("should not throw for valid run ID", () => {
      const db = getDb();
      const runId = "run-test-001";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      assert.doesNotThrow(() => {
        scheduleRunCronTeardown(db, runId);
      });
    });

    it("should not throw for non-existent run", () => {
      const db = getDb();
      assert.doesNotThrow(() => {
        scheduleRunCronTeardown(db, "non-existent-run");
      });
    });
  });
});
