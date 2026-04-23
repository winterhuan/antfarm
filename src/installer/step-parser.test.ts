/**
 * Step Parser Test Suite (15 tests)
 *
 * Tests for step-parser.ts module
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
import fs from "node:fs";

let testDbCounter = 0;

function getTestDbPath(): string {
  return `/tmp/antfarm-step-parser-test-${testDbCounter++}.db`;
}

describe("step-parser", () => {
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
  // parseOutputKeyValues (8 tests)
  // ============================================================================
  describe("parseOutputKeyValues", () => {
    it("should parse simple KEY: value lines", () => {
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
  // parseAndInsertStories (4 tests)
  // ============================================================================
  describe("parseAndInsertStories", () => {
    it("should parse and insert stories from STORIES_JSON", () => {
      const db = getDb();
      const runId = "run-test-001";

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

    it("should throw for stories exceeding max limit", () => {
      const db = getDb();
      const runId = "run-test-004";

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
  });

  // ============================================================================
  // getStories (2 tests)
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
  });
});
