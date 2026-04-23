/**
 * Logs Command Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { logsHandler } from "./logs.js";
import type { CommandContext } from "../command-handler.js";

describe("logs command", () => {
  it("matches logs group", () => {
    const ctx: CommandContext = {
      args: ["logs"],
      group: "logs",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(logsHandler.match(ctx), true);
  });

  it("matches logs with limit", () => {
    const ctx: CommandContext = {
      args: ["logs", "100"],
      group: "logs",
      action: "100",
      target: "",
      flags: {},
    };

    assert.strictEqual(logsHandler.match(ctx), true);
  });

  it("matches logs with run-id", () => {
    const ctx: CommandContext = {
      args: ["logs", "abc123"],
      group: "logs",
      action: "abc123",
      target: "",
      flags: {},
    };

    assert.strictEqual(logsHandler.match(ctx), true);
  });

  it("matches logs with args[0]", () => {
    const ctx: CommandContext = {
      args: ["logs", "100"],
      group: "",
      action: "",
      target: "",
      flags: {},
    };

    assert.strictEqual(logsHandler.match(ctx), true);
  });

  it("has correct name and description", () => {
    assert.strictEqual(logsHandler.name, "logs");
    assert.ok(logsHandler.description.length > 0);
  });
});
