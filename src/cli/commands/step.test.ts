/**
 * Step Command Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { stepHandler } from "./step.js";
import type { CommandContext } from "../command-handler.js";

describe("step command", () => {
  it("matches step group", () => {
    const ctx: CommandContext = {
      args: ["step"],
      group: "step",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(stepHandler.match(ctx), true);
  });

  it("matches step peek", () => {
    const ctx: CommandContext = {
      args: ["step", "peek", "agent-id"],
      group: "step",
      action: "peek",
      target: "agent-id",
      flags: {},
    };

    assert.strictEqual(stepHandler.match(ctx), true);
  });

  it("matches step claim", () => {
    const ctx: CommandContext = {
      args: ["step", "claim", "agent-id"],
      group: "step",
      action: "claim",
      target: "agent-id",
      flags: {},
    };

    assert.strictEqual(stepHandler.match(ctx), true);
  });

  it("matches step complete", () => {
    const ctx: CommandContext = {
      args: ["step", "complete", "step-id"],
      group: "step",
      action: "complete",
      target: "step-id",
      flags: {},
    };

    assert.strictEqual(stepHandler.match(ctx), true);
  });

  it("matches step fail", () => {
    const ctx: CommandContext = {
      args: ["step", "fail", "step-id"],
      group: "step",
      action: "fail",
      target: "step-id",
      flags: {},
    };

    assert.strictEqual(stepHandler.match(ctx), true);
  });

  it("matches step stories", () => {
    const ctx: CommandContext = {
      args: ["step", "stories", "run-id"],
      group: "step",
      action: "stories",
      target: "run-id",
      flags: {},
    };

    assert.strictEqual(stepHandler.match(ctx), true);
  });

  it("matches step with args[0]", () => {
    const ctx: CommandContext = {
      args: ["step", "peek", "agent-id"],
      group: "",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(stepHandler.match(ctx), true);
  });

  it("has correct name and description", () => {
    assert.strictEqual(stepHandler.name, "step");
    assert.ok(stepHandler.description.length > 0);
  });
});
