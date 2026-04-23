/**
 * Step Parser Module
 *
 * Handles parsing of step output, story management, and template formatting.
 * Approximately 200 lines.
 */

import type { DatabaseSync } from "node:sqlite";
import type { Story } from "./types.js";
import crypto from "node:crypto";
import { freeze, freezeArray } from "../types/immutable.js";

/**
 * Parse KEY: value lines from step output with support for multi-line values.
 * Accumulates continuation lines until the next KEY: boundary or end of output.
 * Returns a map of lowercase keys to their (trimmed) values.
 * Skips STORIES_JSON keys (handled separately).
 */
export function parseOutputKeyValues(output: string): Record<string, string> {
  const lines = output.split("\n");
  let pendingKey: string | null = null;
  let pendingValue = "";

  function commitPending(acc: Record<string, string>): Record<string, string> {
    if (pendingKey && !pendingKey.startsWith("STORIES_JSON")) {
      return { ...acc, [pendingKey.toLowerCase()]: pendingValue.trim() };
    }
    return acc;
  }

  const result = lines.reduce((acc: Record<string, string>, line: string): Record<string, string> => {
    const match = line.match(/^([A-Z_]+):\s*(.*)$/);
    if (match) {
      // New KEY: line found - flush previous key and start new
      const newAcc = commitPending(acc);
      pendingKey = match[1];
      pendingValue = match[2];
      return newAcc;
    } else if (pendingKey) {
      // Continuation line - accumulate value
      pendingValue += "\n" + line;
      return acc;
    }
    return acc;
  }, {});

  // Flush any remaining pending value
  return commitPending(result);
}

/**
 * Parse STORIES_JSON from step output and insert stories into the DB.
 */
export function parseAndInsertStories(
  db: DatabaseSync,
  runId: string,
  output: string
): readonly Story[] {
  const stories = extractStoriesFromOutput(output);

  const now = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO stories (id, run_id, story_index, story_id, title, description, acceptance_criteria, status, retry_count, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 2, ?, ?)"
  );

  const insertedStories: Story[] = [];

  for (let i = 0; i < stories.length; i++) {
    const s = stories[i];
    const id = crypto.randomUUID();
    insert.run(id, runId, i, s.id, s.title, s.description, JSON.stringify(s.acceptanceCriteria as string[]), now, now);

    insertedStories.push(freeze({
      id,
      runId,
      storyIndex: i,
      storyId: s.id,
      title: s.title,
      description: s.description,
      acceptanceCriteria: s.acceptanceCriteria as readonly string[],
      status: "pending",
      retryCount: 0,
      maxRetries: 2,
    }) as Story);
  }

  return freezeArray(insertedStories);
}

/**
 * Extract stories array from STORIES_JSON in output.
 */
function extractStoriesFromOutput(output: string): Array<{
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
}> {
  // Try parsing as JSON first
  try {
    const parsed = JSON.parse(output);
    if (parsed.stories_json && Array.isArray(parsed.stories_json)) {
      return validateAndNormalizeStories(parsed.stories_json);
    }
  } catch {
    // Not pure JSON, try finding STORIES_JSON: prefix
  }

  const lines = output.split("\n");
  const startIdx = lines.findIndex(l => l.startsWith("STORIES_JSON:"));
  if (startIdx === -1) return [];

  // Collect JSON text: first line after prefix, then subsequent lines until next KEY: or end
  const firstLine = lines[startIdx].slice("STORIES_JSON:".length).trim();
  const jsonLines = [firstLine];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^[A-Z_]+:\s/.test(lines[i])) break;
    jsonLines.push(lines[i]);
  }

  const jsonText = jsonLines.join("\n").trim();
  let stories: any[];
  try {
    stories = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Failed to parse STORIES_JSON: ${(e as Error).message}`);
  }

  return validateAndNormalizeStories(stories);
}

/**
 * Validate and normalize stories array.
 */
function validateAndNormalizeStories(stories: any[]): Array<{
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
}> {
  if (!Array.isArray(stories)) {
    throw new Error("STORIES_JSON must be an array");
  }
  if (stories.length > 20) {
    throw new Error(`STORIES_JSON has ${stories.length} stories, max is 20`);
  }

  const seenIds = new Set<string>();

  const normalized = stories.reduce((acc: Array<{ readonly id: string; readonly title: string; readonly description: string; readonly acceptanceCriteria: ReadonlyArray<string> }>, s: any, i: number) => {
    // Accept both camelCase and snake_case
    const ac = s.acceptanceCriteria ?? s.acceptance_criteria;
    if (!s.id || !s.title || !s.description || !Array.isArray(ac) || ac.length === 0) {
      throw new Error(
        `STORIES_JSON story at index ${i} missing required fields (id, title, description, acceptanceCriteria)`
      );
    }
    if (seenIds.has(s.id)) {
      throw new Error(`STORIES_JSON has duplicate story id "${s.id}"`);
    }
    seenIds.add(s.id);
    return [...acc, freeze({
      id: s.id,
      title: s.title,
      description: s.description,
      acceptanceCriteria: freezeArray(ac),
    })];
  }, []);

  return normalized;
}

/**
 * Get all stories for a run, ordered by story_index.
 */
export function getStories(db: DatabaseSync, runId: string): readonly Story[] {
  const rows = db.prepare(
    "SELECT * FROM stories WHERE run_id = ? ORDER BY story_index ASC"
  ).all(runId) as any[];

  return freezeArray(rows.map(r => freeze({
    id: r.id,
    runId: r.run_id,
    storyIndex: r.story_index,
    storyId: r.story_id,
    title: r.title,
    description: r.description,
    acceptanceCriteria: freezeArray(JSON.parse(r.acceptance_criteria)),
    status: r.status,
    output: r.output ?? undefined,
    retryCount: r.retry_count,
    maxRetries: r.max_retries,
  })) as Story[]);
}

/**
 * Get the story currently being worked on by a loop step.
 */
export function getCurrentStory(db: DatabaseSync, stepId: string): Story | null {
  const step = db.prepare(
    "SELECT current_story_id FROM steps WHERE id = ?"
  ).get(stepId) as { current_story_id: string | null } | undefined;

  if (!step?.current_story_id) return null;

  const row = db.prepare("SELECT * FROM stories WHERE id = ?").get(step.current_story_id) as any;
  if (!row) return null;

  return freeze({
    id: row.id,
    runId: row.run_id,
    storyIndex: row.story_index,
    storyId: row.story_id,
    title: row.title,
    description: row.description,
    acceptanceCriteria: freezeArray(JSON.parse(row.acceptance_criteria)),
    status: row.status,
    output: row.output ?? undefined,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
  }) as Story;
}

/**
 * Format a story for template substitution.
 */
export function formatStoryForTemplate(story: Story): string {
  const ac = story.acceptanceCriteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n");
  return `Story ${story.storyId}: ${story.title}\n\n${story.description}\n\nAcceptance Criteria:\n${ac}`;
}

/**
 * Format completed stories list.
 */
export function formatCompletedStories(stories: Story[]): string {
  const done = stories.filter(s => s.status === "done");
  if (done.length === 0) return "(none yet)";
  return done.map(s => `- ${s.storyId}: ${s.title}`).join("\n");
}
