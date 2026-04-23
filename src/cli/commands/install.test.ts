/**
 * Install Command Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { installHandler } from "./install.js";
import type { CommandContext } from "../command-handler.js";

describe("install command", () => {
  it("matches root install command", () => {
    const ctx: CommandContext = {
      args: ["install"],
      group: "install",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(installHandler.match(ctx), true);
  });

  it("does not match workflow install", () => {
    const ctx: CommandContext = {
      args: ["workflow", "install", "my-workflow"],
      group: "workflow",
      action: "install",
      target: "my-workflow",
      flags: {},
    };

    assert.strictEqual(installHandler.match(ctx), false);
  });

  it("does not match install with workflow name", () => {
    const ctx: CommandContext = {
      args: ["install", "some-workflow"],
      group: "install",
      action: "some-workflow",
      target: "",
      flags: {},
    };

    assert.strictEqual(installHandler.match(ctx), false);
  });

  it("has correct name and description", () => {
    assert.strictEqual(installHandler.name, "install");
    assert.ok(installHandler.description.length > 0);
  });
});
