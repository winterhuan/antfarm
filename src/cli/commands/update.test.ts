/**
 * Update Command Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { updateHandler } from "./update.js";
import type { CommandContext } from "../command-handler.js";

describe("update command", () => {
  it("matches update group", () => {
    const ctx: CommandContext = {
      args: ["update"],
      group: "update",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(updateHandler.match(ctx), true);
  });

  it("matches update with args[0]", () => {
    const ctx: CommandContext = {
      args: ["update"],
      group: "",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(updateHandler.match(ctx), true);
  });

  it("does not match other commands", () => {
    const ctx: CommandContext = {
      args: ["workflow", "list"],
      group: "workflow",
      action: "list",
      target: "",
      flags: {},
    };

    assert.strictEqual(updateHandler.match(ctx), false);
  });

  it("has correct name and description", () => {
    assert.strictEqual(updateHandler.name, "update");
    assert.ok(updateHandler.description.length > 0);
  });
});
