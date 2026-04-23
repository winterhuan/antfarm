/**
 * Command Registry
 *
 * Central registry for CLI command handlers.
 * Implements the registry pattern for command dispatch.
 */

import type { CommandHandler, CommandContext } from "./command-handler.js";

const handlers: CommandHandler[] = [];

/**
 * Register a command handler with the registry.
 * @param handler - The command handler to register
 */
export function registerCommand(handler: CommandHandler): void {
  handlers.push(handler);
}

/**
 * Dispatch a command to the appropriate handler.
 * Iterates through registered handlers and executes the first one that matches.
 * @param ctx - The command context
 * @returns true if a handler was found and executed, false otherwise
 */
export async function dispatchCommand(ctx: CommandContext): Promise<boolean> {
  for (const handler of handlers) {
    if (handler.match(ctx)) {
      await handler.execute(ctx);
      return true;
    }
  }
  return false;
}

/**
 * Get all registered command handlers.
 * @returns Array of registered handlers (copy)
 */
export function getRegisteredCommands(): CommandHandler[] {
  return [...handlers];
}

/**
 * Clear all registered commands. Useful for testing.
 */
export function clearCommands(): void {
  handlers.length = 0;
}
