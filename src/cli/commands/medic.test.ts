/**
 * Medic Command Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { medicHandler } from "./medic.js";
import type { CommandContext } from "../command-handler.js";

describe("medic command", () => {
  it("matches medic group", () => {
    const ctx: CommandContext = {
      args: ["medic"],
      group: "medic",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(medicHandler.match(ctx), true);
  });

  it("matches medic install", () => {
    const ctx: CommandContext = {
      args: ["medic", "install"],
      group: "medic",
      action: "install",
      target: "",
      flags: {},
    };

    assert.strictEqual(medicHandler.match(ctx), true);
  });

  it("matches medic run", () => {
    const ctx: CommandContext = {
      args: ["medic", "run"],
      group: "medic",
      action: "run",
      target: "",
      flags: {},
    };

    assert.strictEqual(medicHandler.match(ctx), true);
  });

  it("matches medic status", () => {
    const ctx: CommandContext = {
      args: ["medic", "status"],
      group: "medic",
      action: "status",
      target: "",
      flags: {},
    };

    assert.strictEqual(medicHandler.match(ctx), true);
  });

  it("matches medic log", () => {
    const ctx: CommandContext = {
      args: ["medic", "log"],
      group: "medic",
      action: "log",
      target: "",
      flags: {},
    };

    assert.strictEqual(medicHandler.match(ctx), true);
  });

  it("matches medic with args[0]", () => {
    const ctx: CommandContext = {
      args: ["medic", "status"],
      group: "",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(medicHandler.match(ctx), true);
  });

  it("has correct name and description", () => {
    assert.strictEqual(medicHandler.name, "medic");
    assert.ok(medicHandler.description.length > 0);
  });
});
