/**
 * Step Command
 *
 * Step operations: peek, claim, complete, fail, stories.
 */

import {
  peekStep,
  claimStep,
  completeStep,
  failStep,
  getStories,
} from "../../installer/step-ops.js";
import type { CommandHandler, CommandContext } from "../command-handler.js";
import { CliError } from "../../lib/errors.js";

export const stepHandler: CommandHandler = {
  name: "step",
  description: "Step operations (peek, claim, complete, fail, stories)",

  match(ctx: CommandContext): boolean {
    return ctx.group === "step" || ctx.args[0] === "step";
  },

  async execute(ctx: CommandContext): Promise<void> {
    const action = ctx.action || ctx.args[1];
    const target = ctx.target || ctx.args[2];

    if (action === "peek") {
      if (!target) {
        throw new CliError({
          message: "Missing agent-id for step peek",
          code: "CLI.STEP.MISSING_AGENT_ID",
          exitCode: 1,
          userMessage: "Missing agent-id.\nUsage: antfarm step peek <agent-id>",
        });
      }
      const result = peekStep(target);
      process.stdout.write(result + "\n");
      return;
    }

    if (action === "claim") {
      if (!target) {
        throw new CliError({
          message: "Missing agent-id for step claim",
          code: "CLI.STEP.MISSING_AGENT_ID",
          exitCode: 1,
          userMessage: "Missing agent-id.\nUsage: antfarm step claim <agent-id>",
        });
      }
      const result = claimStep(target);
      if (!result.found) {
        process.stdout.write("NO_WORK\n");
      } else {
        process.stdout.write(
          JSON.stringify({
            stepId: result.stepId,
            runId: result.runId,
            input: result.resolvedInput,
          }) + "\n"
        );
      }
      return;
    }

    if (action === "complete") {
      if (!target) {
        throw new CliError({
          message: "Missing step-id for step complete",
          code: "CLI.STEP.MISSING_STEP_ID",
          exitCode: 1,
          userMessage: "Missing step-id.\nUsage: antfarm step complete <step-id> [output]",
        });
      }

      // Read output from args or stdin
      let output = ctx.args.slice(3).join(" ").trim();
      if (!output) {
        // Read from stdin (piped input)
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer);
        }
        output = Buffer.concat(chunks).toString("utf-8").trim();
      }

      const result = completeStep(target, output);
      process.stdout.write(JSON.stringify(result) + "\n");
      return;
    }

    if (action === "fail") {
      if (!target) {
        throw new CliError({
          message: "Missing step-id for step fail",
          code: "CLI.STEP.MISSING_STEP_ID",
          exitCode: 1,
          userMessage: "Missing step-id.\nUsage: antfarm step fail <step-id> <error>",
        });
      }

      const error = ctx.args.slice(3).join(" ").trim() || "Unknown error";
      const result = await failStep(target, error);
      process.stdout.write(JSON.stringify(result) + "\n");
      return;
    }

    if (action === "stories") {
      if (!target) {
        throw new CliError({
          message: "Missing run-id for step stories",
          code: "CLI.STEP.MISSING_RUN_ID",
          exitCode: 1,
          userMessage: "Missing run-id.\nUsage: antfarm step stories <run-id>",
        });
      }

      const stories = getStories(target);
      if (stories.length === 0) {
        console.log("No stories found for this run.");
        return;
      }

      for (const s of stories) {
        const retryInfo = s.retryCount > 0 ? ` (retry ${s.retryCount})` : "";
        console.log(
          `${s.storyId.padEnd(8)} [${s.status.padEnd(7)}] ${s.title}${retryInfo}`
        );
      }
      return;
    }

    throw new CliError({
      message: `Unknown step action: ${action}`,
      code: "CLI.STEP.UNKNOWN_ACTION",
      exitCode: 1,
      userMessage: `Unknown step action: ${action}. Use: peek, claim, complete, fail, stories`,
    });
  },
};
