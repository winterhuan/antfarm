/**
 * Logs Command
 *
 * Query event logs for recent activity or specific runs.
 */

import { getRecentEvents, getRunEvents, type AntfarmEvent } from "../../installer/events.js";
import { formatEventTime } from "../utils.js";
import type { CommandHandler, CommandContext } from "../command-handler.js";

function formatEventLabel(evt: AntfarmEvent): string {
  const labels: Record<string, string> = {
    "run.started": "Run started",
    "run.completed": "Run completed",
    "run.failed": "Run failed",
    "step.pending": "Step pending",
    "step.running": "Claimed step",
    "step.done": "Step completed",
    "step.failed": "Step failed",
    "step.timeout": "Step timed out",
    "story.started": "Story started",
    "story.done": "Story done",
    "story.verified": "Story verified",
    "story.retry": "Story retry",
    "story.failed": "Story failed",
    "pipeline.advanced": "Pipeline advanced",
  };
  return labels[evt.event] ?? evt.event;
}

function printEvents(events: AntfarmEvent[]): void {
  if (events.length === 0) {
    console.log("No events yet.");
    return;
  }

  for (const evt of events) {
    const time = formatEventTime(evt.ts);
    const agent = evt.agentId ? `  ${evt.agentId.split("_").slice(-1)[0]}` : "";
    const label = formatEventLabel(evt);
    const story = evt.storyTitle ? ` — ${evt.storyTitle}` : "";
    const detail = evt.detail ? ` (${evt.detail})` : "";
    const run = evt.runId ? `  [${evt.runId.slice(0, 8)}]` : "";
    console.log(`${time}${run}${agent}  ${label}${story}${detail}`);
  }
}

export const logsHandler: CommandHandler = {
  name: "logs",
  description: "Query event logs for recent activity or specific runs",

  match(ctx: CommandContext): boolean {
    return ctx.group === "logs" || ctx.args[0] === "logs";
  },

  async execute(ctx: CommandContext): Promise<void> {
    const arg = ctx.args[1];

    // Run ID lookup (non-numeric or #N format)
    if (arg && !/^\d+$/.test(arg)) {
      // Looks like a run ID (or prefix)
      if (!/^#\d+$/.test(arg)) {
        const events = getRunEvents(arg);
        if (events.length === 0) {
          console.log(`No events found for run matching "${arg}".`);
        } else {
          printEvents(events);
        }
        return;
      }

      // Support "antfarm logs #3" to show events for run number 3
      const runNum = parseInt(arg.slice(1), 10);
      const db = (await import("../../db.js")).getDb();
      const r = db
        .prepare("SELECT id FROM runs WHERE run_number = ?")
        .get(runNum) as { id: string } | undefined;

      if (r) {
        const events = getRunEvents(r.id);
        if (events.length === 0) {
          console.log(`No events for run #${runNum}.`);
        } else {
          printEvents(events);
        }
      } else {
        console.log(`No run found with number #${runNum}.`);
      }
      return;
    }

    // Default: show recent events
    const limit = parseInt(arg, 10) || 50;
    const events = getRecentEvents(limit);
    printEvents(events);
  },
};
