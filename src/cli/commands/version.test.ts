/**
 * Version Command Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { versionHandler } from "./version.js";
import type { CommandContext } from "../command-handler.js";

describe("version command", () => {
  it("matches --version flag", () => {
    const ctx: CommandContext = {
      args: ["--version"],
      group: "",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(versionHandler.match(ctx), true);
  });

  it("matches -v flag", () => {
    const ctx: CommandContext = {
      args: ["-v"],
      group: "",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(versionHandler.match(ctx), true);
  });

  it("matches version command", () => {
    const ctx: CommandContext = {
      args: ["version"],
      group: "version",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(versionHandler.match(ctx), true);
  });

  it("does not match other commands", () => {
    const ctx: CommandContext = {
      args: ["workflow", "list"],
      group: "workflow",
      action: "list",
      target: "",
      flags: {},
    };

    assert.strictEqual(versionHandler.match(ctx), false);
  });

  it("has correct name and description", () => {
    assert.strictEqual(versionHandler.name, "version");
    assert.ok(versionHandler.description.length > 0);
  });
});
