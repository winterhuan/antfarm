/**
 * Update Command
 *
 * Pulls latest, rebuilds, and reinstalls workflows.
 */

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installWorkflow } from "../../installer/install.js";
import { listBundledWorkflows } from "../../installer/workflow-fetch.js";
import { ensureCliSymlink } from "../../installer/symlink.js";
import { startDaemon, isRunning } from "../../server/daemonctl.js";
import type { CommandHandler, CommandContext } from "../command-handler.js";
import { CliError } from "../../lib/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  try {
    const { readFileSync } = require("node:fs");
    const pkgPath = join(__dirname, "..", "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const updateHandler: CommandHandler = {
  name: "update",
  description: "Pull latest, rebuild, and reinstall workflows",

  match(ctx: CommandContext): boolean {
    return ctx.group === "update" || ctx.args[0] === "update";
  },

  async execute(): Promise<void> {
    const repoRoot = join(__dirname, "..", "..", "..");
    console.log("Pulling latest...");

    try {
      execSync("git pull", { cwd: repoRoot, stdio: "inherit" });
    } catch {
      throw new CliError({
        message: "Failed to git pull",
        code: "CLI.UPDATE.GIT_PULL_FAILED",
        exitCode: 1,
        userMessage: "Failed to git pull. Are you in the antfarm repo?",
      });
    }

    console.log("Installing dependencies...");
    execSync("npm install", { cwd: repoRoot, stdio: "inherit" });

    console.log("Building...");
    execSync("npm run build", { cwd: repoRoot, stdio: "inherit" });

    // Reinstall workflows
    const workflows = await listBundledWorkflows();
    if (workflows.length > 0) {
      console.log(`Reinstalling ${workflows.length} workflow(s)...`);
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
    }

    ensureCliSymlink();
    console.log(`\nUpdated to v${getVersion()}.`);

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
  },
};
