/**
 * Dashboard Command Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { dashboardHandler } from "./dashboard.js";
import type { CommandContext } from "../command-handler.js";

describe("dashboard command", () => {
  it("matches dashboard group", () => {
    const ctx: CommandContext = {
      args: ["dashboard"],
      group: "dashboard",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(dashboardHandler.match(ctx), true);
  });

  it("matches dashboard start", () => {
    const ctx: CommandContext = {
      args: ["dashboard", "start"],
      group: "dashboard",
      action: "start",
      target: "",
      flags: {},
    };

    assert.strictEqual(dashboardHandler.match(ctx), true);
  });

  it("matches dashboard stop", () => {
    const ctx: CommandContext = {
      args: ["dashboard", "stop"],
      group: "dashboard",
      action: "stop",
      target: "",
      flags: {},
    };

    assert.strictEqual(dashboardHandler.match(ctx), true);
  });

  it("matches dashboard status", () => {
    const ctx: CommandContext = {
      args: ["dashboard", "status"],
      group: "dashboard",
      action: "status",
      target: "",
      flags: {},
    };

    assert.strictEqual(dashboardHandler.match(ctx), true);
  });

  it("matches dashboard with args[0]", () => {
    const ctx: CommandContext = {
      args: ["dashboard", "start"],
      group: "",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(dashboardHandler.match(ctx), true);
  });

  it("has correct name and description", () => {
    assert.strictEqual(dashboardHandler.name, "dashboard");
    assert.ok(dashboardHandler.description.length > 0);
  });
});
