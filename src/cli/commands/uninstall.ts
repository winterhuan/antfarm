/**
 * Uninstall Command
 *
 * Uninstalls workflows, agents, crons, and database.
 */

import { uninstallAllWorkflows, checkActiveRuns } from "../../installer/uninstall.js";
import { isRunning, stopDaemon } from "../../server/daemonctl.js";
import type { CommandHandler, CommandContext } from "../command-handler.js";
import { CliError } from "../../lib/errors.js";

export const uninstallHandler: CommandHandler = {
  name: "uninstall",
  description: "Uninstall workflows, agents, crons, and database",

  match(ctx: CommandContext): boolean {
    // Root-level uninstall: "antfarm uninstall [--force]"
    return ctx.group === "uninstall" && (!ctx.args[1] || ctx.args[1] === "--force");
  },

  async execute(ctx: CommandContext): Promise<void> {
    const force = ctx.args.includes("--force");
    const activeRuns = checkActiveRuns();

    if (activeRuns.length > 0 && !force) {
      let message = `Cannot uninstall: ${activeRuns.length} active run(s):\n`;
      for (const run of activeRuns) {
        message += `  - ${run.id} (${run.workflow_id}): ${run.task}\n`;
      }
      message += `\nUse --force to uninstall anyway.`;

      throw new CliError({
        message: "Active runs prevent uninstall",
        code: "CLI.UNINSTALL.ACTIVE_RUNS",
        exitCode: 1,
        userMessage: message,
      });
    }

    // Stop dashboard if running
    if (isRunning().running) {
      stopDaemon();
      console.log("Dashboard stopped.");
    }

    await uninstallAllWorkflows();
    console.log("Antfarm fully uninstalled (workflows, agents, crons, database, skill).");
  },
};
