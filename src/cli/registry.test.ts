/**
 * Registry Tests
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { registerCommand, dispatchCommand, getRegisteredCommands, clearCommands } from "./registry.js";
import type { CommandHandler, CommandContext } from "./command-handler.js";

describe("registry", () => {
  beforeEach(() => {
    clearCommands();
  });

  it("registers commands", () => {
    const handler: CommandHandler = {
      name: "test",
      description: "Test",
      match: () => true,
      execute: async () => {},
    };

    registerCommand(handler);
    const commands = getRegisteredCommands();

    assert.strictEqual(commands.length, 1);
    assert.strictEqual(commands[0], handler);
  });

  it("dispatches to matching handler", async () => {
    let called = false;
    const handler: CommandHandler = {
      name: "test",
      description: "Test",
      match: (ctx) => ctx.args[0] === "test",
      execute: async () => {
        called = true;
      },
    };

    registerCommand(handler);
    const handled = await dispatchCommand({
      args: ["test"],
      group: "",
      action: "",
      target: "",
      flags: {},
    });

    assert.strictEqual(handled, true);
    assert.strictEqual(called, true);
  });

  it("returns false for unknown command", async () => {
    const handled = await dispatchCommand({
      args: ["unknown"],
      group: "",
      action: "",
      target: "",
      flags: {},
    });

    assert.strictEqual(handled, false);
  });

  it("dispatches to first matching handler", async () => {
    let firstCalled = false;
    let secondCalled = false;

    const firstHandler: CommandHandler = {
      name: "first",
      description: "First handler",
      match: () => true,
      execute: async () => {
        firstCalled = true;
      },
    };

    const secondHandler: CommandHandler = {
      name: "second",
      description: "Second handler",
      match: () => true,
      execute: async () => {
        secondCalled = true;
      },
    };

    registerCommand(firstHandler);
    registerCommand(secondHandler);

    await dispatchCommand({
      args: ["anything"],
      group: "",
      action: "",
      target: "",
      flags: {},
    });

    assert.strictEqual(firstCalled, true);
    assert.strictEqual(secondCalled, false);
  });

  it("returns isolated copy of registered commands", () => {
    const handler: CommandHandler = {
      name: "test",
      description: "Test",
      match: () => true,
      execute: async () => {},
    };

    registerCommand(handler);
    const first = getRegisteredCommands();
    const second = getRegisteredCommands();

    assert.notStrictEqual(first, second);
    assert.deepStrictEqual(first, second);
  });

  it("clearCommands removes all handlers", () => {
    const handler: CommandHandler = {
      name: "test",
      description: "Test",
      match: () => true,
      execute: async () => {},
    };

    registerCommand(handler);
    assert.strictEqual(getRegisteredCommands().length, 1);

    clearCommands();
    assert.strictEqual(getRegisteredCommands().length, 0);
  });
});
