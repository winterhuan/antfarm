/**
 * Step Operations Test Suite (45 tests)
 *
 * Tests for step-ops.ts decomposition into 5 focused modules.
 * Uses builders from tests/helpers/builders.ts and errors from src/lib/errors.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { getDb, initDb, closeDb } from "../db.js";
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
  peekStep,
  claimStep,
  completeStep,
  failStep,
  cleanupAbandonedSteps,
} from "./step-lifecycle.js";
import {
  handleVerifyEachCompletion,
  checkLoopContinuation,
  shouldRetryStory,
  processStoryRetries,
} from "./step-loop.js";
import {
  getWorkflowId,
  scheduleRunCronTeardown,
  readProgressFile,
  archiveRunProgress,
} from "./step-utils.js";
import { buildStory } from "../../tests/helpers/builders.js";
import type { Story } from "./types.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Counter for unique test database paths
let testDbCounter = 0;

function getTestDbPath(): string {
  return `/tmp/antfarm-step-ops-test-${testDbCounter++}.db`;
}

describe("step-ops", () => {
  let currentTestDbPath: string;

  beforeEach(() => {
    currentTestDbPath = getTestDbPath();
    initDb(currentTestDbPath);
  });

  afterEach(() => {
    closeDb();
    // Clean up test database files
    try {
      fs.unlinkSync(currentTestDbPath);
      fs.unlinkSync(currentTestDbPath + "-shm");
      fs.unlinkSync(currentTestDbPath + "-wal");
    } catch { /* ignore */ }
  });

  // ============================================================================
  // parseOutputKeyValues (8 tests)
  // ============================================================================
  describe("parseOutputKeyValues", () => {
    it("should parse simple key=value lines", () => {
      const output = "STATUS: done\nRESULT: success";
      const result = parseOutputKeyValues(output);
      assert.strictEqual(result.status, "done");
      assert.strictEqual(result.result, "success");
    });

    it("should handle multiline values", () => {
      const output = "DESCRIPTION: First line\nSecond line\nThird line\nOTHER: value";
      const result = parseOutputKeyValues(output);
      assert.strictEqual(result.description, "First line\nSecond line\nThird line");
      assert.strictEqual(result.other, "value");
    });

    it("should return empty object for empty output", () => {
      const result = parseOutputKeyValues("");
      assert.deepStrictEqual(result, {});
    });

    it("should return empty object for whitespace-only output", () => {
      const result = parseOutputKeyValues("   \n\n   ");
      assert.deepStrictEqual(result, {});
    });

    it("should skip STORIES_JSON keys", () => {
      const output = 'STORIES_JSON: [{"id": "1"}]\nSTATUS: done';
      const result = parseOutputKeyValues(output);
      assert.strictEqual(result.status, "done");
      assert.strictEqual(result.stories_json, undefined);
    });

    it("should handle keys with underscores", () => {
      const output = "MY_KEY: value1\nANOTHER_KEY: value2";
      const result = parseOutputKeyValues(output);
      assert.strictEqual(result.my_key, "value1");
      assert.strictEqual(result.another_key, "value2");
    });

    it("should trim values", () => {
      const output = "KEY:   value with spaces   ";
      const result = parseOutputKeyValues(output);
      assert.strictEqual(result.key, "value with spaces");
    });

    it("should handle output without any KEY: lines", () => {
      const output = "Just some plain text\nwithout any key value pairs";
      const result = parseOutputKeyValues(output);
      assert.deepStrictEqual(result, {});
    });
  });

  // ============================================================================
  // parseAndInsertStories (6 tests)
  // ============================================================================
  describe("parseAndInsertStories", () => {
    it("should parse and insert stories from STORIES_JSON", () => {
      const db = getDb();
      const runId = "run-test-001";

      // Create run first
      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const output = JSON.stringify({
        stories_json: [{
          id: "story-001",
          title: "Test Story",
          description: "A test story",
          acceptanceCriteria: ["Criterion 1", "Criterion 2"]
        }]
      });

      parseAndInsertStories(db, runId, output);

      const stories = getStories(db, runId);
      assert.strictEqual(stories.length, 1);
      assert.strictEqual(stories[0].storyId, "story-001");
      assert.strictEqual(stories[0].title, "Test Story");
    });

    it("should handle snake_case acceptance_criteria", () => {
      const db = getDb();
      const runId = "run-test-002";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const output = JSON.stringify({
        stories_json: [{
          id: "story-002",
          title: "Test Story 2",
          description: "Another test story",
          acceptance_criteria: ["Crit 1", "Crit 2"]
        }]
      });

      parseAndInsertStories(db, runId, output);

      const stories = getStories(db, runId);
      assert.strictEqual(stories.length, 1);
      assert.deepStrictEqual(stories[0].acceptanceCriteria, ["Crit 1", "Crit 2"]);
    });

    it("should throw for invalid JSON", () => {
      const db = getDb();
      const runId = "run-test-003";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const output = "STORIES_JSON: invalid json here";

      assert.throws(() => {
        parseAndInsertStories(db, runId, output);
      }, /Failed to parse STORIES_JSON/);
    });

    it("should throw for non-array stories", () => {
      const db = getDb();
      const runId = "run-test-004";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const output = 'STORIES_JSON: {"not": "an array"}';

      assert.throws(() => {
        parseAndInsertStories(db, runId, output);
      }, /STORIES_JSON must be an array/);
    });

    it("should throw for stories exceeding max limit", () => {
      const db = getDb();
      const runId = "run-test-005";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const stories = Array(21).fill(null).map((_, i) => ({
        id: `story-${i}`,
        title: `Story ${i}`,
        description: "Desc",
        acceptanceCriteria: ["Crit"]
      }));

      const output = `STORIES_JSON: ${JSON.stringify(stories)}`;

      assert.throws(() => {
        parseAndInsertStories(db, runId, output);
      }, /max is 20/);
    });

    it("should throw for duplicate story IDs", () => {
      const db = getDb();
      const runId = "run-test-006";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const output = JSON.stringify({
        stories_json: [
          { id: "dup-id", title: "Story 1", description: "Desc 1", acceptanceCriteria: ["Crit"] },
          { id: "dup-id", title: "Story 2", description: "Desc 2", acceptanceCriteria: ["Crit"] }
        ]
      });

      assert.throws(() => {
        parseAndInsertStories(db, runId, output);
      }, /duplicate story id/);
    });
  });

  // ============================================================================
  // getStories/getCurrentStory (5 tests)
  // ============================================================================
  describe("getStories", () => {
    it("should return empty array when no stories exist", () => {
      const db = getDb();
      const stories = getStories(db, "non-existent-run");
      assert.deepStrictEqual(stories, []);
    });

    it("should return stories ordered by story_index", () => {
      const db = getDb();
      const runId = "run-test-007";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO stories (id, run_id, story_index, story_id, title, description, acceptance_criteria, status, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("s1", runId, 2, "story-c", "Story C", "Desc C", "[]", "pending", 0, 3, now, now);
      db.prepare(
        "INSERT INTO stories (id, run_id, story_index, story_id, title, description, acceptance_criteria, status, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("s2", runId, 0, "story-a", "Story A", "Desc A", "[]", "pending", 0, 3, now, now);
      db.prepare(
        "INSERT INTO stories (id, run_id, story_index, story_id, title, description, acceptance_criteria, status, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("s3", runId, 1, "story-b", "Story B", "Desc B", "[]", "pending", 0, 3, now, now);

      const stories = getStories(db, runId);
      assert.strictEqual(stories.length, 3);
      assert.strictEqual(stories[0].storyId, "story-a");
      assert.strictEqual(stories[1].storyId, "story-b");
      assert.strictEqual(stories[2].storyId, "story-c");
    });

    it("should parse acceptanceCriteria JSON", () => {
      const db = getDb();
      const runId = "run-test-008";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO stories (id, run_id, story_index, story_id, title, description, acceptance_criteria, status, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("s1", runId, 0, "story-1", "Story 1", "Desc", JSON.stringify(["Crit 1", "Crit 2"]), "pending", 0, 3, now, now);

      const stories = getStories(db, runId);
      assert.deepStrictEqual(stories[0].acceptanceCriteria, ["Crit 1", "Crit 2"]);
    });
  });

  describe("getCurrentStory", () => {
    it("should return null when step has no current story", () => {
      const db = getDb();
      const runId = "run-test-009";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-1", runId, "step-public", "agent-1", "single", "input", "pending", 0, now, now);

      const story = getCurrentStory(db, "step-1");
      assert.strictEqual(story, null);
    });

    it("should return current story when set", () => {
      const db = getDb();
      const runId = "run-test-010";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      const storyId = "story-current";
      db.prepare(
        "INSERT INTO stories (id, run_id, story_index, story_id, title, description, acceptance_criteria, status, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(storyId, runId, 0, "s-001", "Current Story", "Desc", JSON.stringify(["Crit"]), "running", 0, 3, now, now);

      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, current_story_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-2", runId, "step-public", "agent-1", "loop", "input", "running", 0, storyId, now, now);

      const story = getCurrentStory(db, "step-2");
      assert.notStrictEqual(story, null);
      assert.strictEqual(story?.storyId, "s-001");
      assert.strictEqual(story?.title, "Current Story");
    });
  });

  // ============================================================================
  // formatStoryForTemplate (4 tests)
  // ============================================================================
  describe("formatStoryForTemplate", () => {
    it("should format story with acceptance criteria", () => {
      const story = buildStory({
        storyId: "STORY-001",
        title: "Test Feature",
        description: "This is a test feature",
        acceptanceCriteria: ["User can login", "User can logout"]
      });

      const formatted = formatStoryForTemplate(story);
      assert.ok(formatted.includes("Story STORY-001: Test Feature"));
      assert.ok(formatted.includes("This is a test feature"));
      assert.ok(formatted.includes("Acceptance Criteria:"));
      assert.ok(formatted.includes("1. User can login"));
      assert.ok(formatted.includes("2. User can logout"));
    });

    it("should handle single acceptance criterion", () => {
      const story = buildStory({
        storyId: "STORY-002",
        title: "Simple Feature",
        description: "Simple desc",
        acceptanceCriteria: ["Only one criterion"]
      });

      const formatted = formatStoryForTemplate(story);
      assert.ok(formatted.includes("1. Only one criterion"));
    });

    it("should handle empty acceptance criteria", () => {
      const story = buildStory({
        storyId: "STORY-003",
        title: "Empty Criteria Feature",
        description: "Desc",
        acceptanceCriteria: []
      });

      const formatted = formatStoryForTemplate(story);
      assert.ok(formatted.includes("Story STORY-003: Empty Criteria Feature"));
      assert.ok(formatted.includes("Acceptance Criteria:"));
    });

    it("should format completed stories list", () => {
      const stories = [
        buildStory({ storyId: "S1", title: "Story One", status: "done" }),
        buildStory({ storyId: "S2", title: "Story Two", status: "pending" }),
        buildStory({ storyId: "S3", title: "Story Three", status: "done" }),
      ];

      const formatted = formatCompletedStories(stories);
      assert.ok(formatted.includes("- S1: Story One"));
      assert.ok(formatted.includes("- S3: Story Three"));
      assert.ok(!formatted.includes("S2"));
    });
  });

  // ============================================================================
  // resolveTemplate (6 tests)
  // ============================================================================
  describe("resolveTemplate", () => {
    it("should resolve simple variables", () => {
      const template = "Hello {{name}}!";
      const context = { name: "World" };
      const result = resolveTemplate(template, context);
      assert.strictEqual(result, "Hello World!");
    });

    it("should resolve multiple variables", () => {
      const template = "{{greeting}} {{name}}, welcome to {{place}}!";
      const context = { greeting: "Hello", name: "Alice", place: "Wonderland" };
      const result = resolveTemplate(template, context);
      assert.strictEqual(result, "Hello Alice, welcome to Wonderland!");
    });

    it("should handle case-insensitive matching", () => {
      const template = "Hello {{NAME}}!";
      const context = { name: "World" };
      const result = resolveTemplate(template, context);
      assert.strictEqual(result, "Hello World!");
    });

    it("should mark missing variables", () => {
      const template = "Hello {{missing}}!";
      const context = {};
      const result = resolveTemplate(template, context);
      assert.strictEqual(result, "Hello [missing: missing]!");
    });

    it("should handle nested dot notation", () => {
      const template = "Value: {{config.value}}";
      const context = { "config.value": "123" };
      const result = resolveTemplate(template, context);
      assert.strictEqual(result, "Value: 123");
    });

    it("should handle empty template", () => {
      const result = resolveTemplate("", {});
      assert.strictEqual(result, "");
    });
  });

  describe("findMissingTemplateKeys", () => {
    it("should find missing keys", () => {
      const template = "{{a}} {{b}} {{c}}";
      const context = { a: "1", b: "2" };
      const missing = findMissingTemplateKeys(template, context);
      assert.deepStrictEqual(missing, ["c"]);
    });

    it("should return empty array when all keys present", () => {
      const template = "{{a}} {{b}}";
      const context = { a: "1", b: "2" };
      const missing = findMissingTemplateKeys(template, context);
      assert.deepStrictEqual(missing, []);
    });

    it("should handle case-insensitive matching", () => {
      const template = "{{UPPER}}";
      const context = { upper: "value" };
      const missing = findMissingTemplateKeys(template, context);
      assert.deepStrictEqual(missing, []);
    });

    it("should deduplicate missing keys", () => {
      const template = "{{key}} {{key}} {{key}}";
      const context = {};
      const missing = findMissingTemplateKeys(template, context);
      assert.deepStrictEqual(missing, ["key"]);
    });
  });

  describe("computeHasFrontendChanges", () => {
    it("should return true for frontend files", () => {
      const files = ["src/components/Button.tsx", "src/App.css"];
      const result = computeHasFrontendChanges(files);
      assert.strictEqual(result, true);
    });

    it("should return false for non-frontend files", () => {
      const files = ["src/server/api.ts", "README.md"];
      const result = computeHasFrontendChanges(files);
      assert.strictEqual(result, false);
    });

    it("should return true for mixed frontend and backend files", () => {
      const files = ["src/components/Button.tsx", "src/server/api.ts"];
      const result = computeHasFrontendChanges(files);
      assert.strictEqual(result, true);
    });

    it("should return false for empty file list", () => {
      const result = computeHasFrontendChanges([]);
      assert.strictEqual(result, false);
    });
  });

  // ============================================================================
  // claimStep (6 tests)
  // ============================================================================
  describe("claimStep", () => {
    it("should claim pending step for agent", () => {
      const db = getDb();
      const runId = "run-test-011";
      const agentId = "agent-claim";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", JSON.stringify({ repo: "/tmp", branch: "main" }), new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-3", runId, "step-public", agentId, "single", "Do work for {{run_id}}", "pending", 0, now, now);

      const result = claimStep(db, agentId, runId);
      assert.strictEqual(result.found, true);
      assert.strictEqual(result.stepId, "step-3");
      assert.ok(result.resolvedInput?.includes(runId));
    });

    it("should return not found when no pending steps", () => {
      const db = getDb();
      const result = claimStep(db, "agent-1", "non-existent-run");
      assert.strictEqual(result.found, false);
    });

    it("should not claim already running step", () => {
      const db = getDb();
      const runId = "run-test-012";
      const agentId = "agent-running";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-4", runId, "step-public", agentId, "single", "input", "running", 0, now, now);

      const result = claimStep(db, agentId, runId);
      assert.strictEqual(result.found, false);
    });

    it("should fail step with missing template keys", () => {
      const db = getDb();
      const runId = "run-test-013";
      const agentId = "agent-missing";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-5", runId, "step-public", agentId, "single", "Work on {{missing_key}}", "pending", 0, now, now);

      const result = claimStep(db, agentId, runId);
      assert.strictEqual(result.found, false);

      const step = db.prepare("SELECT status, output FROM steps WHERE id = ?").get("step-5") as { status: string; output: string };
      assert.strictEqual(step.status, "failed");
      assert.ok(step.output.includes("missing required template key"));
    });

    it("should handle loop step with stories", () => {
      const db = getDb();
      const runId = "run-test-014";
      const agentId = "agent-loop";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", JSON.stringify({ repo: "/tmp", branch: "main" }), new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, loop_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-loop", runId, "loop-public", agentId, "loop", "Process {{current_story}}", "pending", 0, JSON.stringify({ over: "stories" }), now, now);

      // Insert story
      db.prepare(
        "INSERT INTO stories (id, run_id, story_index, story_id, title, description, acceptance_criteria, status, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("story-loop-1", runId, 0, "s-loop", "Loop Story", "Desc", JSON.stringify(["Crit"]), "pending", 0, 3, now, now);

      const result = claimStep(db, agentId, runId);
      assert.strictEqual(result.found, true);

      const story = getCurrentStory(db, "step-loop");
      assert.notStrictEqual(story, null);
      assert.strictEqual(story?.storyId, "s-loop");
    });

    it("should fail loop step when no stories exist", () => {
      const db = getDb();
      const runId = "run-test-015";
      const agentId = "agent-loop-empty";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", JSON.stringify({ repo: "/tmp", branch: "main" }), new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, loop_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-loop-empty", runId, "loop-empty", agentId, "loop", "Process stories", "pending", 0, JSON.stringify({ over: "stories" }), now, now);

      const result = claimStep(db, agentId, runId);
      assert.strictEqual(result.found, false);

      const step = db.prepare("SELECT status FROM steps WHERE id = ?").get("step-loop-empty") as { status: string };
      assert.strictEqual(step.status, "failed");
    });
  });

  // ============================================================================
  // completeStep (5 tests)
  // ============================================================================
  describe("completeStep", () => {
    it("should mark step as done and advance pipeline", () => {
      const db = getDb();
      const runId = "run-test-016";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-6", runId, "step-complete", "agent-1", "single", "input", "running", 0, now, now);

      const result = completeStep(db, "step-6", "STATUS: done\nOutput complete");
      assert.strictEqual(result.advanced, true);

      const step = db.prepare("SELECT status FROM steps WHERE id = ?").get("step-6") as { status: string };
      assert.strictEqual(step.status, "done");
    });

    it("should merge KEY: value output into context", () => {
      const db = getDb();
      const runId = "run-test-017";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", JSON.stringify({ existing: "value" }), new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-7", runId, "step-context", "agent-1", "single", "input", "running", 0, now, now);

      completeStep(db, "step-7", "NEW_KEY: new_value\nANOTHER: test");

      const run = db.prepare("SELECT context FROM runs WHERE id = ?").get(runId) as { context: string };
      const context = JSON.parse(run.context);
      assert.strictEqual(context.existing, "value");
      assert.strictEqual(context.new_key, "new_value");
      assert.strictEqual(context.another, "test");
    });

    it("should parse STORIES_JSON from output", () => {
      const db = getDb();
      const runId = "run-test-018";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-8", runId, "step-stories", "agent-1", "single", "input", "running", 0, now, now);

      const storiesOutput = JSON.stringify({
        stories_json: [{
          id: "parsed-story",
          title: "Parsed Story",
          description: "Desc",
          acceptanceCriteria: ["Crit"]
        }]
      });

      completeStep(db, "step-8", storiesOutput);

      const stories = getStories(db, runId);
      assert.strictEqual(stories.length, 1);
      assert.strictEqual(stories[0].storyId, "parsed-story");
    });

    it("should complete run when all steps done", () => {
      const db = getDb();
      const runId = "run-test-019";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-final", runId, "step-last", "agent-1", "single", "input", "running", 0, now, now);

      const result = completeStep(db, "step-final", "STATUS: done");
      assert.strictEqual(result.runCompleted, true);

      const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
      assert.strictEqual(run.status, "completed");
    });

    it("should not process completion for failed run", () => {
      const db = getDb();
      const runId = "run-test-020";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "failed", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-failed-run", runId, "step-f", "agent-1", "single", "input", "running", 0, now, now);

      const result = completeStep(db, "step-failed-run", "STATUS: done");
      assert.strictEqual(result.advanced, false);
      assert.strictEqual(result.runCompleted, false);
    });
  });

  // ============================================================================
  // failStep (5 tests)
  // ============================================================================
  describe("failStep", () => {
    it("should retry step when under maxRetries", () => {
      const db = getDb();
      const runId = "run-test-021";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-9", runId, "step-retry", "agent-1", "single", "input", "running", 0, 0, 3, now, now);

      const result = failStep(db, "step-9", "Error occurred");
      assert.strictEqual(result.retrying, true);
      assert.strictEqual(result.runFailed, false);

      const step = db.prepare("SELECT status, retry_count FROM steps WHERE id = ?").get("step-9") as { status: string; retry_count: number };
      assert.strictEqual(step.status, "pending");
      assert.strictEqual(step.retry_count, 1);
    });

    it("should fail run when maxRetries exhausted", () => {
      const db = getDb();
      const runId = "run-test-022";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-10", runId, "step-fail", "agent-1", "single", "input", "running", 0, 3, 3, now, now);

      const result = failStep(db, "step-10", "Final error");
      assert.strictEqual(result.retrying, false);
      assert.strictEqual(result.runFailed, true);

      const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
      assert.strictEqual(run.status, "failed");
    });

    it("should handle loop step story retry", () => {
      const db = getDb();
      const runId = "run-test-023";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      const storyId = "story-retry";
      db.prepare(
        "INSERT INTO stories (id, run_id, story_index, story_id, title, description, acceptance_criteria, status, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(storyId, runId, 0, "s-retry", "Retry Story", "Desc", JSON.stringify(["Crit"]), "running", 0, 3, now, now);

      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, current_story_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-loop-retry", runId, "loop-retry", "agent-1", "loop", "input", "running", 0, storyId, now, now);

      const result = failStep(db, "step-loop-retry", "Story error");
      assert.strictEqual(result.retrying, true);

      const story = db.prepare("SELECT status, retry_count FROM stories WHERE id = ?").get(storyId) as { status: string; retry_count: number };
      assert.strictEqual(story.status, "pending");
      assert.strictEqual(story.retry_count, 1);
    });

    it("should fail story when maxRetries exhausted for loop step", () => {
      const db = getDb();
      const runId = "run-test-024";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      const storyId = "story-exhausted";
      db.prepare(
        "INSERT INTO stories (id, run_id, story_index, story_id, title, description, acceptance_criteria, status, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(storyId, runId, 0, "s-exhausted", "Exhausted Story", "Desc", JSON.stringify(["Crit"]), "running", 3, 3, now, now);

      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, current_story_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-loop-exhausted", runId, "loop-exhausted", "agent-1", "loop", "input", "running", 0, storyId, now, now);

      const result = failStep(db, "step-loop-exhausted", "Final story error");
      assert.strictEqual(result.retrying, false);
      assert.strictEqual(result.runFailed, true);

      const story = db.prepare("SELECT status FROM stories WHERE id = ?").get(storyId) as { status: string };
      assert.strictEqual(story.status, "failed");
    });

    it("should throw error for non-existent step", () => {
      const db = getDb();
      assert.throws(() => {
        failStep(db, "non-existent-step", "Error");
      }, /Step not found/);
    });
  });

  // ============================================================================
  // peekStep (1 test - already covered partially)
  // ============================================================================
  describe("peekStep", () => {
    it("should return HAS_WORK when pending steps exist", () => {
      const db = getDb();
      const runId = "run-test-025";
      const agentId = "agent-peek";

      db.prepare(
        "INSERT INTO runs (id, workflow_id, task, status, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(runId, "wf-001", "Test Task", "running", "{}", new Date().toISOString(), new Date().toISOString());

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO steps (id, run_id, step_id, agent_id, type, input_template, status, step_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("step-peek", runId, "step-p", agentId, "single", "input", "pending", 0, now, now);

      const result = peekStep(db, agentId);
      assert.strictEqual(result, "HAS_WORK");
    });

    it("should return NO_WORK when no pending steps", () => {
      const db = getDb();
      const result = peekStep(db, "agent-no-work");
      assert.strictEqual(result, "NO_WORK");
    });
  });
});
