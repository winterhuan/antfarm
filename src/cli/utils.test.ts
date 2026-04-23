/**
 * Utils Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  formatEventTime,
  parseBackendFlag,
  parseFlags,
  parseArgs,
} from "./utils.js";

describe("utils", () => {
  describe("formatEventTime", () => {
    it("formats timestamp to locale time string", () => {
      const timestamp = "2024-01-15T14:30:00.000Z";
      const result = formatEventTime(timestamp);

      // Should return a time string in 12-hour format
      assert.ok(typeof result === "string");
      assert.ok(result.includes(":") || result.includes("AM") || result.includes("PM"));
    });

    it("handles different timestamps", () => {
      const morning = formatEventTime("2024-01-15T08:00:00.000Z");
      const evening = formatEventTime("2024-01-15T20:00:00.000Z");

      assert.ok(typeof morning === "string");
      assert.ok(typeof evening === "string");
    });
  });

  describe("parseBackendFlag", () => {
    it("returns undefined when --backend not present", () => {
      const args = ["workflow", "install", "my-workflow"];
      const result = parseBackendFlag(args);

      assert.strictEqual(result, undefined);
    });

    it("returns backend type when --backend present", () => {
      const args = ["workflow", "install", "my-workflow", "--backend", "hermes"];
      const result = parseBackendFlag(args);

      assert.strictEqual(result, "hermes");
    });

    it("handles openclaw backend", () => {
      const args = ["--backend", "openclaw"];
      const result = parseBackendFlag(args);

      assert.strictEqual(result, "openclaw");
    });

    it("handles claude-code backend", () => {
      const args = ["--backend", "claude-code"];
      const result = parseBackendFlag(args);

      assert.strictEqual(result, "claude-code");
    });

    it("handles codex backend", () => {
      const args = ["--backend", "codex"];
      const result = parseBackendFlag(args);

      assert.strictEqual(result, "codex");
    });

    it("returns undefined for invalid backend", () => {
      const args = ["--backend", "invalid-backend"];
      const result = parseBackendFlag(args);

      assert.strictEqual(result, undefined);
    });

    it("returns undefined when backend value missing", () => {
      const args = ["workflow", "install", "--backend"];
      const result = parseBackendFlag(args);

      assert.strictEqual(result, undefined);
    });
  });

  describe("parseFlags", () => {
    it("returns empty object for no flags", () => {
      const args = ["workflow", "install", "my-workflow"];
      const result = parseFlags(args);

      assert.deepStrictEqual(result, {});
    });

    it("parses --flag value format", () => {
      const args = ["--backend", "hermes", "workflow"];
      const result = parseFlags(args);

      assert.strictEqual(result.backend, "hermes");
    });

    it("parses --flag format (boolean)", () => {
      const args = ["--force", "workflow"];
      const result = parseFlags(args);

      assert.strictEqual(result.force, true);
    });

    it("parses --flag=value format", () => {
      const args = ["--port=8080", "dashboard"];
      const result = parseFlags(args);

      assert.strictEqual(result.port, "8080");
    });

    it("parses multiple flags", () => {
      const args = ["--backend", "hermes", "--force", "--port", "8080"];
      const result = parseFlags(args);

      assert.strictEqual(result.backend, "hermes");
      assert.strictEqual(result.force, true);
      assert.strictEqual(result.port, "8080");
    });

    it("parses single character flags", () => {
      const args = ["-v", "-f"];
      const result = parseFlags(args);

      assert.strictEqual(result.v, true);
      assert.strictEqual(result.f, true);
    });

    it("parses single character flags with values", () => {
      const args = ["-p", "8080"];
      const result = parseFlags(args);

      assert.strictEqual(result.p, "8080");
    });

    it("stops parsing flag value at next flag", () => {
      const args = ["--backend", "hermes", "--force"];
      const result = parseFlags(args);

      assert.strictEqual(result.backend, "hermes");
      assert.strictEqual(result.force, true);
    });
  });

  describe("parseArgs", () => {
    it("parses basic command structure", () => {
      const args = ["workflow", "list"];
      const result = parseArgs(args);

      assert.strictEqual(result.group, "workflow");
      assert.strictEqual(result.action, "list");
      assert.strictEqual(result.target, "");
      assert.deepStrictEqual(result.args, args);
    });

    it("parses command with target", () => {
      const args = ["workflow", "install", "my-workflow"];
      const result = parseArgs(args);

      assert.strictEqual(result.group, "workflow");
      assert.strictEqual(result.action, "install");
      assert.strictEqual(result.target, "my-workflow");
    });

    it("parses command with flags", () => {
      const args = ["workflow", "install", "my-workflow", "--backend", "hermes"];
      const result = parseArgs(args);

      assert.strictEqual(result.group, "workflow");
      assert.strictEqual(result.action, "install");
      assert.strictEqual(result.target, "my-workflow");
      assert.strictEqual(result.flags.backend, "hermes");
    });

    it("handles empty args", () => {
      const args: string[] = [];
      const result = parseArgs(args);

      assert.strictEqual(result.group, "");
      assert.strictEqual(result.action, "");
      assert.strictEqual(result.target, "");
      assert.deepStrictEqual(result.flags, {});
    });

    it("handles single arg", () => {
      const args = ["install"];
      const result = parseArgs(args);

      assert.strictEqual(result.group, "install");
      assert.strictEqual(result.action, "");
      assert.strictEqual(result.target, "");
    });

    it("handles version flag", () => {
      const args = ["--version"];
      const result = parseArgs(args);

      assert.strictEqual(result.group, "");
      assert.strictEqual(result.flags.version, true);
    });

    it("handles complex command with multiple flags", () => {
      const args = [
        "workflow",
        "run",
        "my-workflow",
        "--backend",
        "hermes",
        "--notify-url",
        "https://example.com",
        "my task title"
      ];
      const result = parseArgs(args);

      assert.strictEqual(result.group, "workflow");
      assert.strictEqual(result.action, "run");
      assert.strictEqual(result.target, "my-workflow");
      assert.strictEqual(result.flags.backend, "hermes");
      assert.strictEqual(result.flags["notify-url"], "https://example.com");
    });
  });
});
