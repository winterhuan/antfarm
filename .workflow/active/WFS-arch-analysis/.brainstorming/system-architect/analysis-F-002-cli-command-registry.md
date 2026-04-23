# Feature F-002: cli-command-registry — System Architect Analysis

## Current State

cli.ts (770 lines) has a single `main()` function with all command routing via chained `if` blocks. Each handler is inline.

## Command Inventory

| Group | Action | Lines | Dependencies |
|-------|--------|-------|--------------|
| root | version | 175-178 | pkgPath |
| root | update | 186-216 | execSync, installWorkflow |
| root | install | 241-269 | installWorkflow, startDaemon |
| root | uninstall | 218-239 | uninstallAllWorkflows |
| dashboard | start/stop/status | 271-315 | daemon module |
| medic | install/uninstall/run/status/log | 317-406 | medic module |
| step | peek/claim/complete/fail/stories | 408-461 | step-ops |
| logs | query/limit | 463-493 | events module |
| workflow | 10 subcommands | 498-760 | various |

## Proposed Structure

### `src/cli/command-handler.ts` — Types and registry

```typescript
export interface CommandContext {
  args: string[];
  group: string;
  action: string;
  target: string;
}

export interface CommandHandler {
  name: string;
  description: string;
  match(ctx: CommandContext): boolean;
  execute(ctx: CommandContext): Promise<void>;
}
```

### Command Files
- `src/cli/commands/version.ts` — version, --version, -v
- `src/cli/commands/install.ts` — root-level install
- `src/cli/commands/uninstall.ts` — root-level uninstall
- `src/cli/commands/dashboard.ts` — dashboard start/stop/status
- `src/cli/commands/medic.ts` — medic subcommands
- `src/cli/commands/step.ts` — step subcommands
- `src/cli/commands/logs.ts` — logs
- `src/cli/commands/workflow.ts` — all workflow subcommands (~250 lines)

### Registry Pattern

```typescript
// src/cli/registry.ts
const handlers: CommandHandler[] = [];
export function registerCommand(handler: CommandHandler): void { handlers.push(handler); }
export async function dispatchCommand(ctx: CommandContext): Promise<void> {
  const handler = handlers.find(h => h.match(ctx));
  if (!handler) { printUsage(); process.exit(1); }
  await handler.execute(ctx);
}
```

The `main()` function reduces to: parse args into `CommandContext`, call `dispatchCommand(ctx)`. Node.js runtime check (lines 1-16) stays as top-level guard.

## Key Design Decisions

- **Keep manual arg parsing**: No new dependencies. Encapsulate per-command.
- **Grouped workflow commands**: 10 subcommands stay in one `workflow.ts` (~250 lines)
- **Shared utilities** in `src/cli/utils.ts`: formatEventTime, parseBackendFlag, printUsage
- **Error propagation**: Each handler throws `CliError`. Top-level catch handles display. No `process.exit(1)` inside handlers.
