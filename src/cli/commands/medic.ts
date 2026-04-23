/**
 * Medic Command
 *
 * Medic health watchdog commands (install, uninstall, run, status, log).
 */

import { runMedicCheck, getMedicStatus, getRecentMedicChecks } from "../../medic/medic.js";
import {
  installMedicCron,
  uninstallMedicCron,
  isMedicCronInstalled,
} from "../../medic/medic-cron.js";
import type { CommandHandler, CommandContext } from "../command-handler.js";
import { CliError } from "../../lib/errors.js";

export const medicHandler: CommandHandler = {
  name: "medic",
  description: "Medic health watchdog commands",

  match(ctx: CommandContext): boolean {
    return ctx.group === "medic" || ctx.args[0] === "medic";
  },

  async execute(ctx: CommandContext): Promise<void> {
    const action = ctx.action || ctx.args[1];

    if (action === "install") {
      const result = await installMedicCron();
      if (result.ok) {
        console.log("Medic watchdog installed (checks every 5 minutes).");
      } else {
        throw new CliError({
          message: `Failed to install medic: ${result.error}`,
          code: "CLI.MEDIC.INSTALL_FAILED",
          exitCode: 1,
          userMessage: `Failed to install medic: ${result.error}`,
        });
      }
      return;
    }

    if (action === "uninstall") {
      const result = await uninstallMedicCron();
      if (result.ok) {
        console.log("Medic watchdog removed.");
      } else {
        throw new CliError({
          message: `Failed to uninstall medic: ${result.error}`,
          code: "CLI.MEDIC.UNINSTALL_FAILED",
          exitCode: 1,
          userMessage: `Failed to uninstall medic: ${result.error}`,
        });
      }
      return;
    }

    if (action === "run") {
      const wantsJson = ctx.args.includes("--json");
      const result = await runMedicCheck();

      if (wantsJson) {
        console.log(
          JSON.stringify({
            id: result.id,
            checkedAt: result.checkedAt,
            issuesFound: result.issuesFound,
            actionsTaken: result.actionsTaken,
            summary: result.summary,
            findings: result.findings,
          })
        );
        return;
      }

      if (result.issuesFound === 0) {
        console.log(`All clear — no issues found (${result.checkedAt})`);
      } else {
        console.log(`Medic check complete: ${result.summary}`);
        console.log("");
        for (const f of result.findings) {
          const icon = f.severity === "critical" ? "!!!" : f.severity === "warning" ? " ! " : "   ";
          const fix = f.remediated ? " [FIXED]" : "";
          console.log(`  ${icon} ${f.message}${fix}`);
        }
      }
      return;
    }

    if (action === "status") {
      const status = getMedicStatus();
      const cronInstalled = await isMedicCronInstalled();

      console.log("Antfarm Medic");
      console.log(`  Cron: ${cronInstalled ? "installed (every 5 min)" : "not installed"}`);

      if (status.lastCheck) {
        const ago = Math.round(
          (Date.now() - new Date(status.lastCheck.checkedAt).getTime()) / 60000
        );
        console.log(`  Last check: ${ago}min ago — ${status.lastCheck.summary}`);
      } else {
        console.log("  Last check: never");
      }

      console.log(
        `  Last 24h: ${status.recentChecks} checks, ${status.recentIssues} issues found, ${status.recentActions} auto-fixed`
      );
      return;
    }

    if (action === "log") {
      const target = ctx.target || ctx.args[2];
      const limit = target ? parseInt(target, 10) || 20 : 20;
      const checks = getRecentMedicChecks(limit);

      if (checks.length === 0) {
        console.log("No medic checks recorded yet.");
        return;
      }

      for (const check of checks) {
        const ts = new Date(check.checkedAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        const icon = check.issuesFound > 0 ? (check.actionsTaken > 0 ? "~" : "X") : ".";
        console.log(`  ${icon} ${ts} — ${check.summary}`);
      }
      return;
    }

    throw new CliError({
      message: `Unknown medic action: ${action}`,
      code: "CLI.MEDIC.UNKNOWN_ACTION",
      exitCode: 1,
      userMessage: `Unknown medic action: ${action}. Use: install, uninstall, run, status, log`,
    });
  },
};
