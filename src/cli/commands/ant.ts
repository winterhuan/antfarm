/**
 * Ant Command
 *
 * Displays the ant ASCII art.
 */

import type { CommandHandler, CommandContext } from "../command-handler.js";

export function printAnt(): void {
  console.log(`
    /\\
   /  \\
  /    \\
 /______\\
|   __   |
|  /  \\  |
|  \\__/  |
|________|

  antfarm
  `);
}

export const antHandler: CommandHandler = {
  name: "ant",
  description: "Show ant ASCII art",

  match(ctx: CommandContext): boolean {
    return ctx.group === "ant" || ctx.args[0] === "ant";
  },

  async execute(): Promise<void> {
    printAnt();
  },
};
