import crypto from "node:crypto";
import { loadWorkflowSpec } from "./workflow-spec.js";
import { resolveWorkflowDir } from "./paths.js";
import { getDb, nextRunNumber } from "../db.js";
import { logger } from "../lib/logger.js";
import { emitEvent } from "./events.js";
import { createBackend, groupAgentsByBackend } from "../backend/index.js";
import type { BackendType } from "../backend/interface.js";

export async function runWorkflow(params: {
  workflowId: string;
  taskTitle: string;
  notifyUrl?: string;
  backend?: BackendType;
}): Promise<{ id: string; runNumber: number; workflowId: string; task: string; status: string }> {
  const workflowDir = resolveWorkflowDir(params.workflowId);
  const workflow = await loadWorkflowSpec(workflowDir);

  if (workflow.agents.length === 0) {
    throw new Error(`Workflow ${workflow.id} has no agents defined`);
  }

  // Resolve backend per-agent and group by type (CLI > agent > workflow > global > default)
  const agentsByBackend = await groupAgentsByBackend(workflow, params.backend);

  // For backward compatibility, store the "primary" backend (most agents)
  const primaryBackendType = getPrimaryBackend(agentsByBackend);

  const db = getDb();
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const runNumber = nextRunNumber();

  const initialContext: Record<string, string> = {
    task: params.taskTitle,
    ...workflow.context,
  };

  db.exec("BEGIN");
  try {
    const notifyUrl = params.notifyUrl ?? workflow.notifications?.url ?? null;
    const insertRun = db.prepare(
      "INSERT INTO runs (id, run_number, workflow_id, task, status, context, notify_url, backend, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)"
    );
    insertRun.run(runId, runNumber, workflow.id, params.taskTitle, JSON.stringify(initialContext), notifyUrl, primaryBackendType, now, now);

    const insertStep = db.prepare(
      "INSERT INTO steps (id, run_id, step_id, agent_id, step_index, input_template, expects, status, max_retries, type, loop_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      const stepUuid = crypto.randomUUID();
      const agentId = `${workflow.id}_${step.agent}`;
      const status = i === 0 ? "pending" : "waiting";
      const maxRetries = step.max_retries ?? step.on_fail?.max_retries ?? 2;
      const stepType = step.type ?? "single";
      const loopConfig = step.loop ? JSON.stringify(step.loop) : null;
      insertStep.run(stepUuid, runId, step.id, agentId, i, step.input, step.expects, status, maxRetries, stepType, loopConfig, now, now);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // Start the run via each backend
  const startedBackends: Array<{ type: BackendType; agents: typeof workflow.agents }> = [];
  try {
    for (const [backendType, agents] of agentsByBackend) {
      const backend = createBackend(backendType);
      const subWorkflow = { ...workflow, agents };
      await backend.startRun(subWorkflow);
      startedBackends.push({ type: backendType, agents });
    }
  } catch (err) {
    // Best-effort cleanup: stop already started backends
    for (const { type, agents } of startedBackends) {
      try {
        const backend = createBackend(type);
        const subWorkflow = { ...workflow, agents };
        await backend.stopRun(subWorkflow);
      } catch (stopErr) {
        // Log but don't fail - we're already in error handling
        console.error(`Warning: Failed to stop backend ${type} during rollback:`, stopErr);
      }
    }

    // Roll back the run since it can't advance without the backend
    const db2 = getDb();
    const failedAt = new Date().toISOString();
    db2.prepare("UPDATE runs SET status = 'failed', updated_at = ? WHERE id = ?").run(failedAt, runId);

    // Emit failure event for dashboard visibility
    emitEvent({
      ts: failedAt,
      event: "run.failed",
      runId,
      workflowId: workflow.id,
      detail: err instanceof Error ? err.message : String(err),
    });

    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot start workflow run: backend start failed. ${message}`);
  }

  emitEvent({ ts: new Date().toISOString(), event: "run.started", runId, workflowId: workflow.id });

  logger.info(`Run started: "${params.taskTitle}"`, {
    workflowId: workflow.id,
    runId,
    stepId: workflow.steps[0]?.id,
  });

  return { id: runId, runNumber, workflowId: workflow.id, task: params.taskTitle, status: "running" };
}

/**
 * Determine the "primary" backend for a run (the one with most agents).
 * Used for backward-compatible metadata storage.
 */
function getPrimaryBackend(agentsByBackend: Map<BackendType, unknown[]>): BackendType {
  let maxCount = 0;
  let primary: BackendType = 'openclaw';

  for (const [type, agents] of agentsByBackend) {
    if (agents.length > maxCount) {
      maxCount = agents.length;
      primary = type;
    }
  }

  return primary;
}
