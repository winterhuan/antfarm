import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, createTestRun, createRunWithSteps, createCompletedRun, createFailedStep } from "./test-db.js";
import { DatabaseSync } from "node:sqlite";

describe("test-db fixtures", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("createRunWithSteps", () => {
    it("creates a run with default step count", () => {
      const result = createRunWithSteps(db, {});

      assert.ok(result.runId);
      assert.equal(result.stepIds.length, 3);

      // Verify run exists
      const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(result.runId) as { id: string } | undefined;
      assert.ok(run);
      assert.equal(run?.id, result.runId);
    });

    it("creates run with custom step count", () => {
      const result = createRunWithSteps(db, { stepCount: 5 });

      assert.equal(result.stepIds.length, 5);
    });

    it("creates run with custom runId", () => {
      const result = createRunWithSteps(db, { runId: "my-custom-run" });

      assert.equal(result.runId, "my-custom-run");
    });

    it("creates steps with specified statuses", () => {
      const result = createRunWithSteps(db, {
        stepCount: 3,
        statuses: ["done", "running", "pending"],
      });

      // Verify step statuses
      const steps = db.prepare("SELECT * FROM steps WHERE run_id = ? ORDER BY step_index").all(result.runId) as Array<{
        status: string;
        step_id: string;
      }>;

      assert.equal(steps.length, 3);
      assert.equal(steps[0].status, "done");
      assert.equal(steps[1].status, "running");
      assert.equal(steps[2].status, "pending");
    });
  });

  describe("createCompletedRun", () => {
    it("creates a completed run with done steps", () => {
      const runId = createCompletedRun(db);

      // Verify run status
      const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | undefined;
      assert.equal(run?.status, "completed");

      // Verify all steps are done
      const steps = db.prepare("SELECT status FROM steps WHERE run_id = ?").all(runId) as Array<{ status: string }>;
      assert.equal(steps.length, 3);
      for (const step of steps) {
        assert.equal(step.status, "done");
      }
    });

    it("uses custom runId when provided", () => {
      const runId = createCompletedRun(db, "custom-completed-run");

      assert.equal(runId, "custom-completed-run");
    });
  });

  describe("createFailedStep", () => {
    it("creates a new failed step", () => {
      const { runId } = createRunWithSteps(db, { stepCount: 2 });

      createFailedStep(db, runId, "step-5");

      // Verify step exists
      const step = db.prepare("SELECT status, output FROM steps WHERE run_id = ? AND step_id = ?").get(runId, "step-5") as
        | { status: string; output: string }
        | undefined;
      assert.ok(step);
      assert.equal(step?.status, "failed");
      assert.ok(step?.output.includes("Failed after 1 retries"));
    });

    it("updates existing step to failed", () => {
      const { runId, stepIds } = createRunWithSteps(db, { stepCount: 2 });
      const stepId = stepIds[0];

      // Verify step is initially pending
      let step = db.prepare("SELECT status FROM steps WHERE run_id = ? AND step_id = ?").get(runId, stepId) as
        | { status: string }
        | undefined;
      assert.equal(step?.status, "pending");

      // Mark as failed
      createFailedStep(db, runId, stepId, 3);

      // Verify step is now failed
      step = db.prepare("SELECT status, output FROM steps WHERE run_id = ? AND step_id = ?").get(runId, stepId) as
        | { status: string; output: string }
        | undefined;
      assert.equal(step?.status, "failed");
      assert.ok(step?.output.includes("Failed after 3 retries"));
    });
  });
});
