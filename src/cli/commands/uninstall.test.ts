/**
 * Uninstall Command Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { uninstallHandler } from "./uninstall.js";
import type { CommandContext } from "../command-handler.js";

describe("uninstall command", () => {
  it("matches root uninstall command", () => {
    const ctx: CommandContext = {
      args: ["uninstall"],
      group: "uninstall",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(uninstallHandler.match(ctx), true);
  });

  it("matches uninstall with --force flag", () => {
    const ctx: CommandContext = {
      args: ["uninstall", "--force"],
      group: "uninstall",
      action: "--force",
      target: "",
      flags: {},
    };

    assert.strictEqual(uninstallHandler.match(ctx), true);
  });

  it("does not match workflow uninstall", () => {
    const ctx: CommandContext = {
      args: ["workflow", "uninstall", "my-workflow"],
      group: "workflow",
      action: "uninstall",
      target: "my-workflow",
      flags: {},
    };

    assert.strictEqual(uninstallHandler.match(ctx), false);
  });

  it("has correct name and description", () => {
    assert.strictEqual(uninstallHandler.name, "uninstall");
    assert.ok(uninstallHandler.description.length > 0);
  });
});
