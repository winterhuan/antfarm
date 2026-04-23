#!/usr/bin/env node

// Runtime check: node:sqlite requires Node.js >= 22 (real Node, not Bun's wrapper)
try {
  await import("node:sqlite");
} catch {
  console.error(
    `Error: node:sqlite is not available.\n\n` +
    `Antfarm requires Node.js >= 22 with native SQLite support.\n` +
    `If you have Bun installed, its \`node\` wrapper does not support node:sqlite via ESM.\n\n` +
    `Fix: ensure the real Node.js 22+ is first on your PATH.\n` +
    `  Check: node -e "require('node:sqlite')"\n` +
    `  See: https://github.com/snarktank/antfarm/issues/54`
  );
  process.exit(1);
}

// Node.js version check
const nodeVersion = process.versions.node;
const major = parseInt(nodeVersion.split(".")[0]);
if (major < 22) {
  console.error(`Node.js >= 22 required (found ${nodeVersion})`);
  process.exit(1);
}

// Import command handlers
import { versionHandler } from "./commands/version.js";
import { installHandler } from "./commands/install.js";
import { uninstallHandler } from "./commands/uninstall.js";
import { dashboardHandler } from "./commands/dashboard.js";
import { medicHandler } from "./commands/medic.js";
import { stepHandler } from "./commands/step.js";
import { logsHandler } from "./commands/logs.js";
import { workflowHandler } from "./commands/workflow.js";
import { updateHandler } from "./commands/update.js";
import { antHandler } from "./commands/ant.js";

// Import registry and utilities
import { registerCommand, dispatchCommand } from "./registry.js";
import { parseArgs, printUsage } from "./utils.js";
import { CliError } from "../lib/errors.js";

// Register all commands
registerCommand(versionHandler);
registerCommand(installHandler);
registerCommand(uninstallHandler);
registerCommand(dashboardHandler);
registerCommand(medicHandler);
registerCommand(stepHandler);
registerCommand(logsHandler);
registerCommand(workflowHandler);
registerCommand(updateHandler);
registerCommand(antHandler);

// Main dispatch
async function main() {
  const ctx = parseArgs(process.argv.slice(2));
  const handled = await dispatchCommand(ctx);
  if (!handled) {
    printUsage();
    process.exit(1);
  }
}

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(err.userMessage || err.message);
    process.exit(err.exitCode || 1);
  }
  console.error(err);
  process.exit(1);
});
