/**
 * Workflow Command Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { workflowHandler } from "./workflow.js";
import type { CommandContext } from "../command-handler.js";

describe("workflow command", () => {
  it("matches workflow group", () => {
    const ctx: CommandContext = {
      args: ["workflow"],
      group: "workflow",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("matches workflow list", () => {
    const ctx: CommandContext = {
      args: ["workflow", "list"],
      group: "workflow",
      action: "list",
      target: "",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("matches workflow install", () => {
    const ctx: CommandContext = {
      args: ["workflow", "install", "my-workflow"],
      group: "workflow",
      action: "install",
      target: "my-workflow",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("matches workflow run", () => {
    const ctx: CommandContext = {
      args: ["workflow", "run", "my-workflow"],
      group: "workflow",
      action: "run",
      target: "my-workflow",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("matches workflow status", () => {
    const ctx: CommandContext = {
      args: ["workflow", "status", "abc123"],
      group: "workflow",
      action: "status",
      target: "abc123",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("matches workflow tick", () => {
    const ctx: CommandContext = {
      args: ["workflow", "tick", "agent-id"],
      group: "workflow",
      action: "tick",
      target: "agent-id",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("matches workflow stop", () => {
    const ctx: CommandContext = {
      args: ["workflow", "stop", "run-id"],
      group: "workflow",
      action: "stop",
      target: "run-id",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("matches workflow resume", () => {
    const ctx: CommandContext = {
      args: ["workflow", "resume", "run-id"],
      group: "workflow",
      action: "resume",
      target: "run-id",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("matches workflow runs", () => {
    const ctx: CommandContext = {
      args: ["workflow", "runs"],
      group: "workflow",
      action: "runs",
      target: "",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("matches workflow uninstall", () => {
    const ctx: CommandContext = {
      args: ["workflow", "uninstall", "my-workflow"],
      group: "workflow",
      action: "uninstall",
      target: "my-workflow",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("matches workflow ensure-crons", () => {
    const ctx: CommandContext = {
      args: ["workflow", "ensure-crons", "my-workflow"],
      group: "workflow",
      action: "ensure-crons",
      target: "my-workflow",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("matches workflow with args[0]", () => {
    const ctx: CommandContext = {
      args: ["workflow", "list"],
      group: "",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(workflowHandler.match(ctx), true);
  });

  it("has correct name and description", () => {
    assert.strictEqual(workflowHandler.name, "workflow");
    assert.ok(workflowHandler.description.length > 0);
  });
});
