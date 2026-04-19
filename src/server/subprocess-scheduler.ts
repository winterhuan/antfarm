import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { getDb } from "../db.js";
import { buildClaudeCodeArgv } from "../backend/claude-code-spawn.js";
import { getCodexProfileName } from "../backend/codex.js";
import { buildCodexExecArgv } from "../backend/codex-spawn.js";
import type { BackendType } from "../backend/interface.js";
import { resolveBackendConfig } from "../backend/config-resolver.js";
import { buildWorkPrompt } from "../installer/agent-cron.js";
import { resolveRunRoot, resolveWorkflowDir, resolveWorkflowWorkspaceRoot } from "../installer/paths.js";
import { claimStep, failStep } from "../installer/step-ops.js";
import type { AgentRole, WorkflowAgent, WorkflowSpec } from "../installer/types.js";
import { loadWorkflowSpec } from "../installer/workflow-spec.js";
import { logger } from "../lib/logger.js";

type SubprocessBackendType = "claude-code" | "codex";

type LaunchableAgentContext = {
  fullAgentId: string;
  workflow: WorkflowSpec;
  workflowId: string;
  agent: WorkflowAgent;
  backend: BackendType;
};

type StepSnapshot = {
  status: string;
  output: string | null;
  currentStoryId: string | null;
  updatedAt: string;
};

type SpawnOutcome = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutTail: string;
  stderrTail: string;
  error?: string;
};

type ActiveProcess = {
  agentId: string;
  backend: SubprocessBackendType;
  runId: string;
  stepId: string;
  child: ChildProcess;
  done: Promise<WorkflowTickResult>;
};

export type WorkflowTickResult =
  | { status: "no_work"; agentId: string }
  | { status: "unsupported_backend"; agentId: string; backend: BackendType }
  | { status: "launch_failed"; agentId: string; stepId: string; runId: string; backend: SubprocessBackendType; error: string }
  | {
      status: "step_executed";
      agentId: string;
      stepId: string;
      runId: string;
      backend: SubprocessBackendType;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      reported: boolean;
    };

type LaunchResult =
  | { kind: "no_work"; agentId: string }
  | { kind: "unsupported_backend"; agentId: string; backend: BackendType }
  | { kind: "launch_failed"; result: Extract<WorkflowTickResult, { status: "launch_failed" }> }
  | { kind: "launched"; active: ActiveProcess };

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_MAX_CONCURRENT = 2;
const OUTPUT_TAIL_LIMIT = 8_000;

const CLAUDE_ROLE_BUDGET: Record<AgentRole, number> = {
  analysis: 0.5,
  coding: 2,
  verification: 0.75,
  testing: 1.5,
  pr: 0.5,
  scanning: 0.5,
};

function appendTail(current: string, chunk: Buffer | string, limit = OUTPUT_TAIL_LIMIT): string {
  const next = current + chunk.toString();
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
}

function splitFullAgentId(fullAgentId: string): { workflowId: string; agentId: string } {
  const separator = fullAgentId.indexOf("_");
  if (separator <= 0 || separator === fullAgentId.length - 1) {
    throw new Error(`Invalid full agent id "${fullAgentId}". Expected <workflow-id>_<agent-id>.`);
  }
  return {
    workflowId: fullAgentId.slice(0, separator),
    agentId: fullAgentId.slice(separator + 1),
  };
}

function getExecutionCwd(runId: string): string {
  const db = getDb();
  const row = db.prepare("SELECT context FROM runs WHERE id = ?").get(runId) as { context: string } | undefined;
  if (!row) return process.cwd();

  try {
    const context = JSON.parse(row.context) as Record<string, string>;
    return context.repo?.trim() || context.run_cwd?.trim() || process.cwd();
  } catch {
    return process.cwd();
  }
}

function getStepSnapshot(stepId: string): StepSnapshot {
  const db = getDb();
  const row = db.prepare(
    `SELECT status,
            output,
            current_story_id AS currentStoryId,
            updated_at AS updatedAt
     FROM steps
     WHERE id = ?`
  ).get(stepId) as StepSnapshot | undefined;

  if (!row) {
    throw new Error(`Step not found: ${stepId}`);
  }
  return row;
}

function getRunStatus(runId: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | undefined;
  return row?.status ?? null;
}

function stepWasReported(before: StepSnapshot, after: StepSnapshot): boolean {
  return (
    before.status !== after.status ||
    before.output !== after.output ||
    before.currentStoryId !== after.currentStoryId ||
    before.updatedAt !== after.updatedAt
  );
}

function getSchedulerCandidates(limit: number): string[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT s.agent_id AS agentId, MIN(r.created_at) AS oldestCreatedAt
     FROM steps s
     JOIN runs r ON r.id = s.run_id
     WHERE s.status = 'pending' AND r.status = 'running'
     GROUP BY s.agent_id
     ORDER BY oldestCreatedAt ASC
     LIMIT ?`
  ).all(limit) as Array<{ agentId: string }>;

  return rows.map((row) => row.agentId);
}

async function loadLaunchableAgentContext(fullAgentId: string): Promise<LaunchableAgentContext> {
  const { workflowId, agentId } = splitFullAgentId(fullAgentId);
  const workflow = await loadWorkflowSpec(resolveWorkflowDir(workflowId));
  const agent = workflow.agents.find((entry) => entry.id === agentId);
  if (!agent) {
    throw new Error(`Agent "${agentId}" not found in workflow "${workflowId}"`);
  }
  const backend = (await resolveBackendConfig(agent, workflow)).type;
  return { fullAgentId, workflow, workflowId, agent, backend };
}

async function loadBootstrapPrompt(workflowId: string, agent: WorkflowAgent): Promise<string> {
  const workspaceDir = path.join(resolveWorkflowWorkspaceRoot(), workflowId, agent.workspace.baseDir.trim());
  const sections: string[] = [];

  for (const fileName of Object.keys(agent.workspace.files).sort()) {
    try {
      const content = await fs.readFile(path.join(workspaceDir, fileName), "utf-8");
      const trimmed = content.trim();
      if (!trimmed) continue;
      sections.push(`--- ${fileName} ---\n${trimmed}`);
    } catch {
      // Missing bootstrap files should not block execution once the workflow is installed.
    }
  }

  if (sections.length === 0) return "";
  return `Bootstrap files from the workflow agent workspace:\n${sections.join("\n\n")}`;
}

async function ensureRuntimeDir(runId: string): Promise<string> {
  const dir = path.join(resolveRunRoot(), runId, "scheduler");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function getClaudeBudget(role: AgentRole | undefined): number {
  return CLAUDE_ROLE_BUDGET[role ?? "coding"];
}

function buildFailureMessage(outcome: SpawnOutcome): string {
  if (outcome.error) {
    return `Failed to launch subprocess backend: ${outcome.error}`;
  }

  const stderr = outcome.stderrTail.trim();
  const stdout = outcome.stdoutTail.trim();
  const detail = stderr || stdout;
  const exit = outcome.exitCode === null ? `signal ${outcome.signal ?? "unknown"}` : `exit ${outcome.exitCode}`;
  return detail ? `Subprocess exited with ${exit}: ${detail}` : `Subprocess exited with ${exit} before reporting step completion.`;
}

async function waitForChildProcess(child: ChildProcess): Promise<SpawnOutcome> {
  let stdoutTail = "";
  let stderrTail = "";

  child.stdout?.on("data", (chunk) => {
    stdoutTail = appendTail(stdoutTail, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderrTail = appendTail(stderrTail, chunk);
  });

  return await new Promise<SpawnOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: SpawnOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    child.once("error", (error) => {
      finish({
        exitCode: null,
        signal: null,
        stdoutTail,
        stderrTail,
        error: error.message,
      });
    });

    child.once("close", (exitCode, signal) => {
      finish({
        exitCode,
        signal,
        stdoutTail,
        stderrTail,
      });
    });
  });
}

async function spawnBackendProcess(params: {
  ctx: LaunchableAgentContext & { backend: SubprocessBackendType };
  runId: string;
  stepId: string;
  prompt: string;
}): Promise<ChildProcess> {
  const cwd = getExecutionCwd(params.runId);
  const runtimeDir = await ensureRuntimeDir(params.runId);

  if (params.ctx.backend === "codex") {
    const argv = buildCodexExecArgv({
      profileName: getCodexProfileName(params.ctx.workflowId, params.ctx.agent.id),
      workspaceDir: cwd,
      prompt: params.prompt,
      lastMessagePath: path.join(runtimeDir, `${params.stepId}-last-message.txt`),
    });
    return spawn(process.env.ANTFARM_CODEX_BIN || "codex", argv, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  const argv = buildClaudeCodeArgv({
    role: params.ctx.agent.role,
    prompt: params.prompt,
    worktreeName: `${params.ctx.fullAgentId}-${params.runId.slice(0, 8)}`,
    sessionId: crypto.randomUUID(),
    maxBudgetUsd: getClaudeBudget(params.ctx.agent.role),
    model: params.ctx.agent.model ?? "sonnet",
  });

  return spawn(process.env.ANTFARM_CLAUDE_BIN || "claude", argv, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function reconcileStepAfterExit(params: {
  ctx: LaunchableAgentContext & { backend: SubprocessBackendType };
  stepId: string;
  runId: string;
  before: StepSnapshot;
  outcome: SpawnOutcome;
}): Promise<WorkflowTickResult> {
  const runStatus = getRunStatus(params.runId);
  if (runStatus && runStatus !== "running") {
    return {
      status: "step_executed",
      agentId: params.ctx.fullAgentId,
      stepId: params.stepId,
      runId: params.runId,
      backend: params.ctx.backend,
      exitCode: params.outcome.exitCode,
      signal: params.outcome.signal,
      reported: true,
    };
  }

  const after = getStepSnapshot(params.stepId);
  if (!stepWasReported(params.before, after)) {
    await failStep(params.stepId, buildFailureMessage(params.outcome));
    return {
      status: "step_executed",
      agentId: params.ctx.fullAgentId,
      stepId: params.stepId,
      runId: params.runId,
      backend: params.ctx.backend,
      exitCode: params.outcome.exitCode,
      signal: params.outcome.signal,
      reported: false,
    };
  }

  return {
    status: "step_executed",
    agentId: params.ctx.fullAgentId,
    stepId: params.stepId,
    runId: params.runId,
    backend: params.ctx.backend,
    exitCode: params.outcome.exitCode,
    signal: params.outcome.signal,
    reported: true,
  };
}

async function launchWorkflowTick(agentId: string): Promise<LaunchResult> {
  const ctx = await loadLaunchableAgentContext(agentId);
  if (ctx.backend !== "claude-code" && ctx.backend !== "codex") {
    return { kind: "unsupported_backend", agentId, backend: ctx.backend };
  }

  const claimed = claimStep(agentId);
  if (!claimed.found || !claimed.stepId || !claimed.runId || !claimed.resolvedInput) {
    return { kind: "no_work", agentId };
  }
  const stepId = claimed.stepId;
  const runId = claimed.runId;
  const resolvedInput = claimed.resolvedInput;

  try {
    const bootstrapPrompt = await loadBootstrapPrompt(ctx.workflowId, ctx.agent);
    const prompt = [
      bootstrapPrompt,
      buildWorkPrompt(ctx.workflowId, ctx.agent.id, ctx.agent.role),
      `CLAIMED STEP JSON:\n${JSON.stringify({ stepId, runId, input: resolvedInput }, null, 2)}`,
    ].filter(Boolean).join("\n\n");

    const before = getStepSnapshot(stepId);
    const spawnedCtx: LaunchableAgentContext & { backend: SubprocessBackendType } = { ...ctx, backend: ctx.backend };
    const child = await spawnBackendProcess({
      ctx: spawnedCtx,
      runId,
      stepId,
      prompt,
    });

    logger.info(`Spawned ${ctx.backend} subprocess`, {
      runId,
      stepId,
      workflowId: ctx.workflowId,
    });

    const done = (async (): Promise<WorkflowTickResult> => {
      const outcome = await waitForChildProcess(child);
      return await reconcileStepAfterExit({
        ctx: spawnedCtx,
        stepId,
        runId,
        before,
        outcome,
      });
    })().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (getRunStatus(runId) === "running") {
        try {
          await failStep(stepId, message);
        } catch {
          // Best-effort only — the scheduler should still surface the launch failure.
        }
      }
      const failure: Extract<WorkflowTickResult, { status: "launch_failed" }> = {
        status: "launch_failed",
        agentId,
        stepId,
        runId,
        backend: spawnedCtx.backend,
        error: message,
      };
      return failure;
    });

    return {
      kind: "launched",
      active: {
        agentId,
        backend: ctx.backend,
        runId,
        stepId,
        child,
        done,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failStep(stepId, message);
    return {
      kind: "launch_failed",
      result: {
        status: "launch_failed",
        agentId,
        stepId,
        runId,
        backend: ctx.backend,
        error: message,
      },
    };
  }
}

export async function tickWorkflowAgent(agentId: string): Promise<WorkflowTickResult> {
  const launch = await launchWorkflowTick(agentId);
  switch (launch.kind) {
    case "no_work":
      return { status: "no_work", agentId: launch.agentId };
    case "unsupported_backend":
      return { status: "unsupported_backend", agentId: launch.agentId, backend: launch.backend };
    case "launch_failed":
      return launch.result;
    case "launched":
      return await launch.active.done;
  }
}

export class SubprocessScheduler {
  private readonly intervalMs: number;
  private readonly maxConcurrent: number;
  private readonly active = new Map<string, ActiveProcess>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private sweeping = false;

  constructor(options?: { intervalMs?: number; maxConcurrent?: number }) {
    const configuredInterval = parseInt(process.env.ANTFARM_SCHEDULER_INTERVAL_MS ?? "", 10);
    const configuredConcurrency = parseInt(process.env.ANTFARM_SCHEDULER_MAX_CONCURRENT ?? "", 10);
    this.intervalMs = options?.intervalMs ?? (Number.isFinite(configuredInterval) && configuredInterval > 0 ? configuredInterval : DEFAULT_INTERVAL_MS);
    this.maxConcurrent = options?.maxConcurrent ?? (Number.isFinite(configuredConcurrency) && configuredConcurrency > 0 ? configuredConcurrency : DEFAULT_MAX_CONCURRENT);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const active of this.active.values()) {
      if (!active.child.killed) {
        active.child.kill("SIGTERM");
      }
    }
    this.active.clear();
  }

  private scheduleNext(delay = this.intervalMs): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.sweep();
    }, delay);
    this.timer.unref?.();
  }

  private async sweep(): Promise<void> {
    if (!this.running) return;
    if (this.sweeping) {
      this.scheduleNext();
      return;
    }

    this.sweeping = true;
    try {
      this.reapTerminalRuns();

      const capacity = Math.max(this.maxConcurrent - this.active.size, 0);
      if (capacity > 0) {
        const candidates = getSchedulerCandidates(capacity * 4);
        for (const agentId of candidates) {
          if (this.active.has(agentId)) continue;
          if (this.active.size >= this.maxConcurrent) break;

          let launch: LaunchResult;
          try {
            launch = await launchWorkflowTick(agentId);
          } catch (error) {
            logger.error(`Scheduler could not launch ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
            continue;
          }
          if (launch.kind !== "launched") continue;

          this.active.set(agentId, launch.active);
          void launch.active.done.finally(() => {
            const current = this.active.get(agentId);
            if (current?.stepId === launch.active.stepId) {
              this.active.delete(agentId);
            }
          });
        }
      }
    } catch (error) {
      logger.error(`Scheduler sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.sweeping = false;
      this.scheduleNext();
    }
  }

  private reapTerminalRuns(): void {
    for (const active of this.active.values()) {
      const runStatus = getRunStatus(active.runId);
      if (runStatus === "running" || runStatus === null) continue;
      if (!active.child.killed) {
        active.child.kill("SIGTERM");
      }
    }
  }
}
