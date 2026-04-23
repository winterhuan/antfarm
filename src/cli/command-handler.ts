/**
 * Command Handler Types
 *
 * Defines the contract for CLI command handlers using the registry pattern.
 */

import type { BackendType } from "../backend/interface.js";

/**
 * Context passed to command handlers containing parsed CLI arguments.
 */
export interface CommandContext {
  /** Original command line arguments */
  args: string[];
  /** Command group (e.g., 'workflow', 'dashboard', '') */
  group: string;
  /** Action within the group (e.g., 'list', 'start') */
  action: string;
  /** Target of the action (e.g., workflow ID, agent ID) */
  target: string;
  /** Parsed flags from command line */
  flags: Record<string, string | boolean>;
}

/**
 * Interface that all command handlers must implement.
 */
export interface CommandHandler {
  /** Command name for identification */
  name: string;
  /** Human-readable description */
  description: string;
  /**
   * Check if this handler should handle the given context.
   * @param ctx - The command context
   * @returns true if this handler should process the command
   */
  match(ctx: CommandContext): boolean;
  /**
   * Execute the command.
   * @param ctx - The command context
   */
  execute(ctx: CommandContext): Promise<void>;
}

/**
 * Options for parsing command line arguments.
 */
export interface ParseArgsOptions {
  /** Arguments to parse (typically process.argv.slice(2)) */
  args: string[];
}

/**
 * Result of parsing backend flag from arguments.
 */
export interface BackendFlagResult {
  /** The backend type if found, undefined otherwise */
  backend?: BackendType;
  /** Arguments with --backend flag removed (if requested) */
  remainingArgs: string[];
}
