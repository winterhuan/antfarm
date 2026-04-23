/**
 * Workflow Command
 *
 * Workflow management commands: list, install, uninstall, run, tick, status, resume, stop, etc.
 */

import { installWorkflow } from "../../installer/install.js";
import { uninstallAllWorkflows, uninstallWorkflow, checkActiveRuns } from "../../installer/uninstall.js";
import {
  getWorkflowStatus,
  listRuns,
  stopWorkflow,
} from "../../installer/status.js";
import { runWorkflow } from "../../installer/run.js";
import { listBundledWorkflows } from "../../installer/workflow-fetch.js";
import { getStories } from "../../installer/step-ops.js";
import { tickWorkflowAgent } from "../../server/subprocess-scheduler.js";
import { startDaemon, isRunning } from "../../server/daemonctl.js";
import type { CommandHandler, CommandContext } from "../command-handler.js";
import { parseBackendFlag, parseFlags } from "../utils.js";
import { CliError } from "../../lib/errors.js";

async function handleList(): Promise<void> {
  const workflows = await listBundledWorkflows();
  if (workflows.length === 0) {
    process.stdout.write("No workflows available.\n");
  } else {
    process.stdout.write("Available workflows:\n");
    for (const w of workflows) process.stdout.write(`  ${w}\n`);
  }
}

async function handleStatus(ctx: CommandContext): Promise<void> {
  const query = ctx.args.slice(2).join(" ").trim();
  if (!query) {
    throw new CliError({
      message: "Missing search query for status",
      code: "CLI.WORKFLOW.MISSING_QUERY",
      exitCode: 1,
      userMessage: "Missing search query.\nUsage: antfarm workflow status <query>",
    });
  }

  const result = getWorkflowStatus(query);
  if (result.status === "not_found") {
    process.stdout.write(`${result.message}\n`);
    return;
  }

  const { run, steps } = result;
  const runLabel = run.run_number != null ? `#${run.run_number} (${run.id})` : run.id;
  const lines = [
    `Run: ${runLabel}`,
    `Workflow: ${run.workflow_id}`,
    `Task: ${run.task.slice(0, 120)}${run.task.length > 120 ? "..." : ""}`,
    `Status: ${run.status}`,
    `Created: ${run.created_at}`,
    `Updated: ${run.updated_at}`,
    "",
    "Steps:",
    ...steps.map((s) => `  [${s.status}] ${s.step_id} (${s.agent_id})`),
  ];

  const stories = getStories(run.id);
  if (stories.length > 0) {
    const done = stories.filter((s) => s.status === "done").length;
    const running = stories.filter((s) => s.status === "running").length;
    const failed = stories.filter((s) => s.status === "failed").length;
    lines.push(
      "",
      `Stories: ${done}/${stories.length} done${running ? `, ${running} running` : ""}${failed ? `, ${failed} failed` : ""}`
    );
    for (const s of stories) {
      lines.push(`  ${s.storyId.padEnd(8)} [${s.status.padEnd(7)}] ${s.title}`);
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}

async function handleRun(ctx: CommandContext, target: string): Promise<void> {
  let notifyUrl: string | undefined;
  const runArgs = ctx.args.slice(3);
  const nuIdx = runArgs.indexOf("--notify-url");

  if (nuIdx !== -1) {
    notifyUrl = runArgs[nuIdx + 1];
    runArgs.splice(nuIdx, 2);
  }

  const backend = parseBackendFlag(runArgs);
  const taskTitle = runArgs.join(" ").trim();

  if (!taskTitle) {
    throw new CliError({
      message: "Missing task title for run",
      code: "CLI.WORKFLOW.MISSING_TASK",
      exitCode: 1,
      userMessage: "Missing task title.\nUsage: antfarm workflow run <name> <task>",
    });
  }

  const run = await runWorkflow({ workflowId: target, taskTitle, notifyUrl, backend });
  process.stdout.write(
    [
      `Run: #${run.runNumber} (${run.id})`,
      `Workflow: ${run.workflowId}`,
      `Task: ${run.task}`,
      `Status: ${run.status}`,
    ].join("\n") + "\n"
  );

  // Ensure dashboard is running
  if (!isRunning().running) {
    try {
      const result = await startDaemon(3333);
      console.log(`\nDashboard started (PID ${result.pid}): http://localhost:${result.port}`);
    } catch (err) {
      console.log(
        `\nNote: Could not start dashboard: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

async function handleTick(ctx: CommandContext, agentId: string): Promise<void> {
  if (!agentId) {
    throw new CliError({
      message: "Missing agent-id for tick",
      code: "CLI.WORKFLOW.MISSING_AGENT_ID",
      exitCode: 1,
      userMessage: "Missing agent-id.\nUsage: antfarm workflow tick <agent-id>",
    });
  }

  const result = await tickWorkflowAgent(agentId);

  if (result.status === "no_work") {
    console.log(`No pending work for ${result.agentId}.`);
    return;
  }

  if (result.status === "unsupported_backend") {
    throw new CliError({
      message: `workflow tick only supports claude-code/codex agents. ${result.agentId} uses ${result.backend}.`,
      code: "CLI.WORKFLOW.UNSUPPORTED_BACKEND",
      exitCode: 1,
      userMessage: `workflow tick only supports claude-code/codex agents. ${result.agentId} uses ${result.backend}.`,
    });
  }

  if (result.status === "launch_failed") {
    throw new CliError({
      message: `Tick failed for ${result.agentId}: ${result.error}`,
      code: "CLI.WORKFLOW.TICK_FAILED",
      exitCode: 1,
      userMessage: `Tick failed for ${result.agentId}: ${result.error}`,
    });
  }

  const exit = result.exitCode === null ? `signal ${result.signal ?? "unknown"}` : `exit ${result.exitCode}`;
  if (result.reported) {
    console.log(
      `Executed ${result.agentId} via ${result.backend} for step ${result.stepId.slice(0, 8)} (${exit}).`
    );
  } else {
    console.log(
      `Executed ${result.agentId} via ${result.backend} for step ${result.stepId.slice(0, 8)} (${exit}); subprocess exited without reporting, so the step was failed.`
    );
  }
}

async function handleStop(target: string): Promise<void> {
  if (!target) {
    throw new CliError({
      message: "Missing run-id for stop",
      code: "CLI.WORKFLOW.MISSING_RUN_ID",
      exitCode: 1,
      userMessage: "Missing run-id.\nUsage: antfarm workflow stop <run-id>",
    });
  }

  const result = await stopWorkflow(target);

  if (result.status === "not_found") {
    throw new CliError({
      message: result.message,
      code: "CLI.WORKFLOW.RUN_NOT_FOUND",
      exitCode: 1,
      userMessage: result.message,
    });
  }

  if (result.status === "already_done") {
    throw new CliError({
      message: result.message,
      code: "CLI.WORKFLOW.ALREADY_DONE",
      exitCode: 1,
      userMessage: result.message,
    });
  }

  console.log(
    `Cancelled run ${result.runId.slice(0, 8)} (${result.workflowId}). ${result.cancelledSteps} step(s) cancelled.`
  );
}

async function handleResume(target: string): Promise<void> {
  if (!target) {
    throw new CliError({
      message: "Missing run-id for resume",
      code: "CLI.WORKFLOW.MISSING_RUN_ID",
      exitCode: 1,
      userMessage: "Missing run-id.\nUsage: antfarm workflow resume <run-id>",
    });
  }

  const db = (await import("../../db.js")).getDb();

  // Find the run (support prefix match and run number)
  let run: { id: string; run_number: number | null; workflow_id: string; status: string } | undefined;

  if (/^\d+$/.test(target)) {
    run = db
      .prepare("SELECT id, run_number, workflow_id, status FROM runs WHERE run_number = ?")
      .get(parseInt(target, 10)) as typeof run;
  }

  if (!run) {
    run = db
      .prepare("SELECT id, run_number, workflow_id, status FROM runs WHERE id = ? OR id LIKE ?")
      .get(target, `${target}%`) as typeof run;
  }

  if (!run) {
    throw new CliError({
      message: `Run not found: ${target}`,
      code: "CLI.WORKFLOW.RUN_NOT_FOUND",
      exitCode: 1,
      userMessage: `Run not found: ${target}`,
    });
  }

  if (run.status !== "failed") {
    throw new CliError({
      message: `Run ${run.id.slice(0, 8)} is "${run.status}", not "failed". Nothing to resume.`,
      code: "CLI.WORKFLOW.NOT_FAILED",
      exitCode: 1,
      userMessage: `Run ${run.id.slice(0, 8)} is "${run.status}", not "failed". Nothing to resume.`,
    });
  }

  // Find the failed step (or first non-done step)
  const failedStep = db
    .prepare(
      "SELECT id, step_id, type, current_story_id FROM steps WHERE run_id = ? AND status = 'failed' ORDER BY step_index ASC LIMIT 1"
    )
    .get(run.id) as { id: string; step_id: string; type: string; current_story_id: string | null } | undefined;

  if (!failedStep) {
    throw new CliError({
      message: `No failed step found in run ${run.id.slice(0, 8)}.`,
      code: "CLI.WORKFLOW.NO_FAILED_STEP",
      exitCode: 1,
      userMessage: `No failed step found in run ${run.id.slice(0, 8)}.`,
    });
  }

  // If it's a loop step with a failed story, reset that story to pending
  if (failedStep.type === "loop") {
    const failedStory = db
      .prepare(
        "SELECT id FROM stories WHERE run_id = ? AND status = 'failed' ORDER BY story_index ASC LIMIT 1"
      )
      .get(run.id) as { id: string } | undefined;

    if (failedStory) {
      db.prepare(
        "UPDATE stories SET status = 'pending', updated_at = datetime('now') WHERE id = ?"
      ).run(failedStory.id);
    }
    db.prepare("UPDATE steps SET retry_count = 0 WHERE run_id = ? AND type = 'loop'").run(run.id);
  }

  // Check if the failed step is a verify step linked to a loop step's verify_each
  const loopStep = db
    .prepare(
      "SELECT id, loop_config FROM steps WHERE run_id = ? AND type = 'loop' AND status IN ('running', 'failed') LIMIT 1"
    )
    .get(run.id) as { id: string; loop_config: string | null } | undefined;

  if (loopStep?.loop_config) {
    const lc = JSON.parse(loopStep.loop_config);
    if (lc.verifyEach && lc.verifyStep === failedStep.step_id) {
      // Reset the loop step (developer) to pending so it re-claims the story and populates context
      db.prepare(
        "UPDATE steps SET status = 'pending', current_story_id = NULL, retry_count = 0, updated_at = datetime('now') WHERE id = ?"
      ).run(loopStep.id);
      // Reset verify step to waiting (fires after developer completes)
      db.prepare(
        "UPDATE steps SET status = 'waiting', current_story_id = NULL, retry_count = 0, updated_at = datetime('now') WHERE id = ?"
      ).run(failedStep.id);
      // Reset any failed stories to pending
      db.prepare(
        "UPDATE stories SET status = 'pending', updated_at = datetime('now') WHERE run_id = ? AND status = 'failed'"
      ).run(run.id);
      // Reset run to running
      db.prepare(
        "UPDATE runs SET status = 'running', updated_at = datetime('now') WHERE id = ?"
      ).run(run.id);

      // Ensure crons are running for this workflow
      const { loadWorkflowSpec } = await import("../../installer/workflow-spec.js");
      const { resolveWorkflowDir } = await import("../../installer/paths.js");
      const { ensureWorkflowCrons } = await import("../../installer/agent-cron.js");

      try {
        const workflowDir = resolveWorkflowDir(run.workflow_id);
        const workflow = await loadWorkflowSpec(workflowDir);
        await ensureWorkflowCrons(workflow);
      } catch (err) {
        console.log(
          `Warning: Could not start crons: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      console.log(
        `Resumed run ${run.id.slice(0, 8)} — reset loop step "${loopStep.id.slice(0, 8)}" to pending, verify step "${failedStep.step_id}" to waiting`
      );

      // Ensure dashboard is running
      if (!isRunning().running) {
        try {
          const result = await startDaemon(3333);
          console.log(`Dashboard started (PID ${result.pid}): http://localhost:${result.port}`);
        } catch (err) {
          console.log(
            `Note: Could not start dashboard: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      return;
    }
  }

  // Reset step to pending
  db.prepare(
    "UPDATE steps SET status = 'pending', current_story_id = NULL, retry_count = 0, updated_at = datetime('now') WHERE id = ?"
  ).run(failedStep.id);

  // Reset run to running
  db.prepare(
    "UPDATE runs SET status = 'running', updated_at = datetime('now') WHERE id = ?"
  ).run(run.id);

  // Ensure crons are running for this workflow
  const { loadWorkflowSpec } = await import("../../installer/workflow-spec.js");
  const { resolveWorkflowDir } = await import("../../installer/paths.js");
  const { ensureWorkflowCrons } = await import("../../installer/agent-cron.js");

  try {
    const workflowDir = resolveWorkflowDir(run.workflow_id);
    const workflow = await loadWorkflowSpec(workflowDir);
    await ensureWorkflowCrons(workflow);
  } catch (err) {
    console.log(
      `Warning: Could not start crons: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  console.log(`Resumed run ${run.id.slice(0, 8)} from step "${failedStep.step_id}"`);

  // Ensure dashboard is running
  if (!isRunning().running) {
    try {
      const result = await startDaemon(3333);
      console.log(`Dashboard started (PID ${result.pid}): http://localhost:${result.port}`);
    } catch (err) {
      console.log(
        `Note: Could not start dashboard: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

async function handleEnsureCrons(target: string): Promise<void> {
  if (!target) {
    throw new CliError({
      message: "Missing workflow name for ensure-crons",
      code: "CLI.WORKFLOW.MISSING_WORKFLOW",
      exitCode: 1,
      userMessage: "Missing workflow name.\nUsage: antfarm workflow ensure-crons <name>",
    });
  }

  const { loadWorkflowSpec } = await import("../../installer/workflow-spec.js");
  const { resolveWorkflowDir } = await import("../../installer/paths.js");
  const { setupAgentCrons, removeAgentCrons } = await import("../../installer/agent-cron.js");

  const workflowDir = resolveWorkflowDir(target);
  const workflow = await loadWorkflowSpec(workflowDir);

  // Force recreate: remove existing then create fresh
  await removeAgentCrons(target);
  await setupAgentCrons(workflow);

  console.log(`Recreated agent crons for workflow "${target}".`);
}

async function handleWorkflowInstall(ctx: CommandContext, target: string): Promise<void> {
  if (!target) {
    throw new CliError({
      message: "Missing workflow name for install",
      code: "CLI.WORKFLOW.MISSING_WORKFLOW",
      exitCode: 1,
      userMessage: "Missing workflow name.\nUsage: antfarm workflow install <name>",
    });
  }

  const backend = parseBackendFlag(ctx.args);
  const result = await installWorkflow({ workflowId: target, backend });

  process.stdout.write(`Installed workflow: ${result.workflowId}\n`);
  process.stdout.write(`Agent crons will start when a run begins.\n`);
  process.stdout.write(`\nStart with: antfarm workflow run ${result.workflowId} "your task"\n`);
}

async function handleWorkflowUninstall(ctx: CommandContext, target: string): Promise<void> {
  const force = ctx.args.includes("--force");
  const isAll = target === "--all" || target === "all";

  const activeRuns = checkActiveRuns(isAll ? undefined : target);
  if (activeRuns.length > 0 && !force) {
    let message = `Cannot uninstall: ${activeRuns.length} active run(s):\n`;
    for (const run of activeRuns) {
      message += `  - ${run.id} (${run.workflow_id}): ${run.task}\n`;
    }
    message += `\nUse --force to uninstall anyway.`;

    throw new CliError({
      message: "Active runs prevent uninstall",
      code: "CLI.WORKFLOW.UNINSTALL_BLOCKED",
      exitCode: 1,
      userMessage: message,
    });
  }

  if (isAll) {
    await uninstallAllWorkflows();
  } else {
    if (!target) {
      throw new CliError({
        message: "Missing workflow name for uninstall",
        code: "CLI.WORKFLOW.MISSING_WORKFLOW",
        exitCode: 1,
        userMessage: "Missing workflow name.\nUsage: antfarm workflow uninstall <name> or --all",
      });
    }
    await uninstallWorkflow({ workflowId: target });
  }

  console.log("Workflow uninstalled successfully.");
}

async function handleRuns(): Promise<void> {
  const runs = listRuns();
  if (runs.length === 0) {
    console.log("No workflow runs found.");
    return;
  }

  console.log("Workflow runs:");
  for (const r of runs) {
    const num = r.run_number != null ? `#${r.run_number}` : r.id.slice(0, 8);
    console.log(
      `  [${r.status.padEnd(9)}] ${num.padEnd(6)} ${r.id.slice(0, 8)}  ${r.workflow_id.padEnd(14)}  ${r.task.slice(0, 50)}${r.task.length > 50 ? "..." : ""}`
    );
  }
}

export const workflowHandler: CommandHandler = {
  name: "workflow",
  description: "Workflow management commands",

  match(ctx: CommandContext): boolean {
    return ctx.group === "workflow" || ctx.args[0] === "workflow";
  },

  async execute(ctx: CommandContext): Promise<void> {
    const action = ctx.action || ctx.args[1];
    const target = ctx.target || ctx.args[2];

    switch (action) {
      case "list":
        await handleList();
        return;
      case "runs":
        await handleRuns();
        return;
      case "status":
        await handleStatus(ctx);
        return;
      case "run":
        await handleRun(ctx, target);
        return;
      case "tick":
        await handleTick(ctx, target);
        return;
      case "stop":
        await handleStop(target);
        return;
      case "resume":
        await handleResume(target);
        return;
      case "install":
        await handleWorkflowInstall(ctx, target);
        return;
      case "uninstall":
        await handleWorkflowUninstall(ctx, target);
        return;
      case "ensure-crons":
        await handleEnsureCrons(target);
        return;
      default:
        throw new CliError({
          message: `Unknown workflow action: ${action}`,
          code: "CLI.WORKFLOW.UNKNOWN_ACTION",
          exitCode: 1,
          userMessage: `Unknown workflow action: ${action}. Use: list, runs, status, run, tick, stop, resume, install, uninstall, ensure-crons`,
        });
    }
  },
};
