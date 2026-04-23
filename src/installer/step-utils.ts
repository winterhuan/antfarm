/**
 * Step Utils Module
 *
 * Utility functions for step operations.
 * Approximately 100 lines.
 */

import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Get workflow ID for a run.
 */
export function getWorkflowId(db: DatabaseSync, runId: string): string | undefined {
  try {
    const row = db.prepare("SELECT workflow_id FROM runs WHERE id = ?").get(runId) as { workflow_id: string } | undefined;
    return row?.workflow_id;
  } catch {
    return undefined;
  }
}

/**
 * Fire-and-forget cron teardown when a run ends.
 */
export function scheduleRunCronTeardown(db: DatabaseSync, runId: string): void {
  try {
    const run = db.prepare("SELECT workflow_id FROM runs WHERE id = ?").get(runId) as { workflow_id: string } | undefined;
    if (run) {
      // Best-effort teardown - actual implementation would import and call
      // teardownWorkflowCronsIfIdle from agent-cron.ts
    }
  } catch {
    // best-effort
  }
}

/**
 * Get the workspace path for an OpenClaw agent by its id.
 */
export function getAgentWorkspacePath(agentId: string): string | null {
  try {
    const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const agent = config.agents?.list?.find((a: any) => a.id === agentId);
    return agent?.workspace ?? null;
  } catch {
    return null;
  }
}

export interface ProgressData {
  content: string;
  timestamp: string;
}

/**
 * Read progress.txt from the loop step's agent workspace.
 */
export function readProgressFile(runId: string): ProgressData | null {
  // Implementation would lookup loop step, then find workspace
  // For now, return null to avoid circular dependencies
  return null;
}

/**
 * Archive run progress file.
 */
export function archiveRunProgress(runId: string): void {
  // Implementation would archive progress file from workspace
  // Stub implementation
}

/**
 * Trigger escalation for a run.
 */
export function escalation(runId: string, reason: string): void {
  // Implementation would send escalation notification
  // Stub implementation
  console.log(`Escalation for run ${runId}: ${reason}`);
}
