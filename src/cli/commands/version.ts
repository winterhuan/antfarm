/**
 * Version Command
 *
 * Displays the antfarm CLI version.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CommandHandler, CommandContext } from "../command-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = join(__dirname, "..", "..", "..", "package.json");

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const versionHandler: CommandHandler = {
  name: "version",
  description: "Show version information",

  match(ctx: CommandContext): boolean {
    return (
      ctx.args.includes("--version") ||
      ctx.args.includes("-v") ||
      (ctx.group === "version" && !ctx.action)
    );
  },

  async execute(): Promise<void> {
    console.log(`antfarm v${getVersion()}`);
  },
};
