/**
 * CLI Utilities
 *
 * Shared utility functions for CLI argument parsing and formatting.
 */

import type { CommandContext, BackendFlagResult } from "./command-handler.js";
import type { BackendType } from "../backend/interface.js";
import { validateBackendType } from "../backend/index.js";

/**
 * Format a timestamp for display in event logs.
 * @param timestamp - ISO timestamp string
 * @returns Formatted time string (e.g., "02:30 PM")
 */
export function formatEventTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

/**
 * Parse --backend flag from CLI arguments.
 * Validates the backend type and returns the value if present.
 * @param args - Command line arguments
 * @returns The backend type if found, undefined otherwise
 */
export function parseBackendFlag(args: string[]): BackendType | undefined {
  const backendIdx = args.indexOf("--backend");
  if (backendIdx === -1) return undefined;

  const backendValue = args[backendIdx + 1];
  if (!backendValue) {
    return undefined;
  }

  try {
    validateBackendType(backendValue);
    return backendValue as BackendType;
  } catch {
    return undefined;
  }
}

/**
 * Parse --backend flag and optionally remove it from args array.
 * @param args - Command line arguments
 * @param options - Parse options
 * @returns Result containing backend and remaining args
 */
export function parseBackendFlagWithRemoval(
  args: string[],
  options: { remove?: boolean } = {}
): BackendFlagResult {
  const backendIdx = args.indexOf("--backend");
  if (backendIdx === -1) {
    return { remainingArgs: [...args] };
  }

  const backendValue = args[backendIdx + 1];
  if (!backendValue) {
    return { remainingArgs: [...args] };
  }

  try {
    validateBackendType(backendValue);
    const result: BackendFlagResult = {
      backend: backendValue as BackendType,
      remainingArgs: [...args],
    };
    if (options.remove) {
      result.remainingArgs.splice(backendIdx, 2);
    }
    return result;
  } catch {
    return { remainingArgs: [...args] };
  }
}

// Known boolean flags that don't take values
const BOOLEAN_FLAGS = new Set([
  "force",
  "yes",
  "json",
  "v",
  "version",
  "help",
  "h",
]);

/**
 * Parse command line flags into a record.
 * Supports --flag value, --flag, and --flag=value formats.
 * @param args - Command line arguments
 * @returns Record of flag names to values
 */
export function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle --flag=value format
    if (arg.startsWith("--") && arg.includes("=")) {
      const [flagName, flagValue] = arg.slice(2).split("=", 2);
      flags[flagName] = flagValue;
      continue;
    }

    // Handle --flag format (with or without value)
    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      const nextArg = args[i + 1];

      // Boolean flags don't consume a value
      if (BOOLEAN_FLAGS.has(flagName)) {
        flags[flagName] = true;
      } else if (nextArg && !nextArg.startsWith("-")) {
        flags[flagName] = nextArg;
        i++; // Skip the value
      } else {
        flags[flagName] = true;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      // Single character flag (-v, -f, etc.)
      const flagName = arg.slice(1);
      const nextArg = args[i + 1];

      // Boolean flags don't consume a value
      if (BOOLEAN_FLAGS.has(flagName)) {
        flags[flagName] = true;
      } else if (nextArg && !nextArg.startsWith("-")) {
        flags[flagName] = nextArg;
        i++;
      } else {
        flags[flagName] = true;
      }
    }
  }

  return flags;
}

/**
 * Parse raw command line arguments into a structured context.
 * @param args - Raw arguments (typically process.argv.slice(2))
 * @returns Structured command context
 */
export function parseArgs(args: string[]): CommandContext {
  const flags = parseFlags(args);

  // Filter out flags to get positional arguments
  const positionalArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Skip flags and their values
    if (arg.startsWith("-")) {
      // Check if this flag takes a value
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        i++; // Skip the value too
      }
      continue;
    }

    positionalArgs.push(arg);
  }

  const [group, action, target] = positionalArgs;

  return {
    args,
    group: group ?? "",
    action: action ?? "",
    target: target ?? "",
    flags,
  };
}

/**
 * Print CLI usage information.
 */
export function printUsage(): void {
  process.stdout.write(
    [
      "antfarm install                      Install all bundled workflows",
      "antfarm uninstall [--force]          Full uninstall (workflows, agents, crons, DB)",
      "",
      "antfarm workflow list                List available workflows",
      "antfarm workflow install <name>      Install a workflow",
      "antfarm workflow install <name> --backend <openclaw|hermes|claude-code|codex>  Install with specific backend",
      "antfarm workflow uninstall <name>    Uninstall a workflow (blocked if runs active)",
      "antfarm workflow uninstall --all     Uninstall all workflows (--force to override)",
      "antfarm workflow run <name> <task>   Start a workflow run",
      "antfarm workflow run <name> <task> --backend <openclaw|hermes|claude-code|codex>  Run with specific backend",
      "antfarm workflow tick <agent-id>     Run one scheduler pass for a Claude/Codex agent",
      "antfarm workflow status <query>      Check run status (task substring, run ID prefix)",
      "antfarm workflow runs                List all workflow runs",
      "antfarm workflow resume <run-id>     Resume a failed run from where it left off",
      "antfarm workflow stop <run-id>        Stop/cancel a running workflow",
      "antfarm workflow ensure-crons <name>  Recreate agent crons for a workflow",
      "",
      "antfarm dashboard [start] [--port N]   Start dashboard daemon (default: 3333)",
      "antfarm dashboard stop                  Stop dashboard daemon",
      "antfarm dashboard status                Check dashboard status",
      "",
      "antfarm step peek <agent-id>        Lightweight check for pending work (HAS_WORK or NO_WORK)",
      "antfarm step claim <agent-id>       Claim pending step, output resolved input as JSON",
      "antfarm step complete <step-id>      Complete step (reads output from stdin)",
      "antfarm step fail <step-id> <error>  Fail step with retry logic",
      "antfarm step stories <run-id>       List stories for a run",
      "",
      "antfarm medic install                Install medic watchdog cron",
      "antfarm medic uninstall              Remove medic cron",
      "antfarm medic run [--json]           Run medic check now (manual trigger)",
      "antfarm medic status                 Show medic health summary",
      "antfarm medic log [<count>]          Show recent medic check history",
      "",
      "antfarm logs [<lines>]               Show recent activity (from events)",
      "antfarm logs <run-id>                Show activity for a specific run",
      "",
      "antfarm version                      Show installed version",
      "antfarm update                       Pull latest, rebuild, and reinstall workflows",
    ].join("\n") + "\n"
  );
}
