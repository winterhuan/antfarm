/**
 * Ant Command Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { antHandler, printAnt } from "./ant.js";
import type { CommandContext } from "../command-handler.js";

describe("ant command", () => {
  it("matches ant group", () => {
    const ctx: CommandContext = {
      args: ["ant"],
      group: "ant",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(antHandler.match(ctx), true);
  });

  it("matches ant with args[0]", () => {
    const ctx: CommandContext = {
      args: ["ant"],
      group: "",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(antHandler.match(ctx), true);
  });

  it("does not match other commands", () => {
    const ctx: CommandContext = {
      args: ["workflow", "list"],
      group: "workflow",
      action: "list",
      target: "",
      flags: {},
    };

    assert.strictEqual(antHandler.match(ctx), false);
  });

  it("has correct name and description", () => {
    assert.strictEqual(antHandler.name, "ant");
    assert.ok(antHandler.description.length > 0);
  });

  describe("printAnt", () => {
    it("outputs ASCII art", () => {
      // Just verify it doesn't throw
      assert.doesNotThrow(() => {
        printAnt();
      });
    });
  });
});
