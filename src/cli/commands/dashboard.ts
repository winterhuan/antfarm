/**
 * Dashboard Command
 *
 * Controls the dashboard daemon (start, stop, status).
 */

import {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  isRunning,
} from "../../server/daemonctl.js";
import type { CommandHandler, CommandContext } from "../command-handler.js";
import { CliError } from "../../lib/errors.js";

export const dashboardHandler: CommandHandler = {
  name: "dashboard",
  description: "Dashboard daemon control (start, stop, status)",

  match(ctx: CommandContext): boolean {
    return ctx.group === "dashboard" || ctx.args[0] === "dashboard";
  },

  async execute(ctx: CommandContext): Promise<void> {
    const action = ctx.action || ctx.args[1] || "start";

    if (action === "stop") {
      if (stopDaemon()) {
        console.log("Dashboard stopped.");
      } else {
        console.log("Dashboard is not running.");
      }
      return;
    }

    if (action === "status") {
      const st = getDaemonStatus();
      if (st && st.running) {
        console.log(`Dashboard running (PID ${st.pid ?? "unknown"})`);
      } else {
        console.log("Dashboard is not running.");
      }
      return;
    }

    // Start (explicit or implicit)
    if (action === "start" || !action) {
      let port = 3333;
      const portIdx = ctx.args.indexOf("--port");

      if (portIdx !== -1 && ctx.args[portIdx + 1]) {
        port = parseInt(ctx.args[portIdx + 1], 10) || 3333;
      } else if (
        ctx.action &&
        ctx.action !== "start" &&
        !ctx.action.startsWith("-")
      ) {
        // Legacy: antfarm dashboard 4000
        const parsed = parseInt(ctx.action, 10);
        if (!Number.isNaN(parsed)) port = parsed;
      }

      if (isRunning().running) {
        const status = getDaemonStatus();
        console.log(`Dashboard already running (PID ${status?.pid})`);
        console.log(`  http://localhost:${port}`);
        return;
      }

      const result = await startDaemon(port);
      console.log(`Dashboard started (PID ${result.pid})`);
      console.log(`  http://localhost:${result.port}`);
      return;
    }

    throw new CliError({
      message: `Unknown dashboard action: ${action}`,
      code: "CLI.DASHBOARD.UNKNOWN_ACTION",
      exitCode: 1,
      userMessage: `Unknown dashboard action: ${action}`,
    });
  },
};
