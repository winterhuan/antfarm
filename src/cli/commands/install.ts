/**
 * Install Command
 *
 * Installs bundled workflows.
 */

import { installWorkflow } from "../../installer/install.js";
import { listBundledWorkflows } from "../../installer/workflow-fetch.js";
import { ensureCliSymlink } from "../../installer/symlink.js";
import { startDaemon, isRunning } from "../../server/daemonctl.js";
import type { CommandHandler, CommandContext } from "../command-handler.js";
import { parseBackendFlag } from "../utils.js";
import { CliError } from "../../lib/errors.js";

export const installHandler: CommandHandler = {
  name: "install",
  description: "Install bundled workflows",

  match(ctx: CommandContext): boolean {
    // Root-level install: "antfarm install" with no workflow name
    return ctx.group === "install" && !ctx.args[1];
  },

  async execute(ctx: CommandContext): Promise<void> {
    const workflows = await listBundledWorkflows();
    if (workflows.length === 0) {
      console.log("No bundled workflows found.");
      return;
    }

    console.log(`Installing ${workflows.length} workflow(s)...`);
    for (const workflowId of workflows) {
      try {
        await installWorkflow({ workflowId });
        console.log(`  ✓ ${workflowId}`);
      } catch (err) {
        console.log(
          `  ✗ ${workflowId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    ensureCliSymlink();
    console.log(`\nDone. Start a workflow with: antfarm workflow run <name> "your task"`);

    // Auto-start dashboard if not already running
    if (!isRunning().running) {
      try {
        const result = await startDaemon(3333);
        console.log(`\nDashboard started (PID ${result.pid}): http://localhost:${result.port}`);
      } catch (err) {
        console.log(
          `\nNote: Could not start dashboard: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } else {
      console.log("\nDashboard already running.");
    }
  },
};
