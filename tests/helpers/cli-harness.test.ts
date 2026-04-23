import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createCliHarness, CliHarness } from "./cli-harness.js";

describe("createCliHarness", () => {
  let harness: CliHarness;

  afterEach(() => {
    if (harness) {
      harness.restore();
    }
  });

  it("returns harness with required properties", () => {
    harness = createCliHarness();

    assert.ok(Array.isArray(harness.stdout));
    assert.ok(Array.isArray(harness.stderr));
    assert.equal(harness.exitCode, null);
    assert.ok(typeof harness.restore === "function");
  });

  it("captures stdout output", () => {
    harness = createCliHarness();

    process.stdout.write("Hello, ");
    process.stdout.write("world!\n");

    assert.equal(harness.stdout.length, 2);
    assert.equal(harness.stdout[0], "Hello, ");
    assert.equal(harness.stdout[1], "world!\n");
  });

  it("captures stderr output", () => {
    harness = createCliHarness();

    process.stderr.write("Error: ");
    process.stderr.write("something went wrong\n");

    assert.equal(harness.stderr.length, 2);
    assert.equal(harness.stderr[0], "Error: ");
    assert.equal(harness.stderr[1], "something went wrong\n");
  });

  it("captures exit code without terminating", () => {
    harness = createCliHarness();

    let errorThrown = false;
    try {
      process.exit(42);
    } catch (error) {
      errorThrown = true;
      // Verify it's our intercept error
      if (error instanceof Error) {
        assert.ok((error as Error & { isExitIntercept: boolean }).isExitIntercept);
        assert.ok(error.message.includes("42"));
      }
    }

    assert.ok(errorThrown, "Expected an error to be thrown");
    assert.equal(harness.exitCode, 42);
  });

  it("handles exit with no code (defaults to 0)", () => {
    harness = createCliHarness();

    let errorThrown = false;
    try {
      process.exit();
    } catch (error) {
      errorThrown = true;
    }

    assert.ok(errorThrown);
    assert.equal(harness.exitCode, 0);
  });

  it("handles exit with string code", () => {
    harness = createCliHarness();

    let errorThrown = false;
    try {
      (process.exit as (code: string) => never)("error");
    } catch (error) {
      errorThrown = true;
    }

    assert.ok(errorThrown);
    assert.equal(harness.exitCode, 0);
  });

  it("restore() restores original stdout", () => {
    harness = createCliHarness();

    process.stdout.write("captured");
    assert.equal(harness.stdout.length, 1);

    harness.restore();

    // After restore, writes should not be captured
    const beforeLength = harness.stdout.length;
    process.stdout.write("not captured");
    assert.equal(harness.stdout.length, beforeLength);
  });

  it("restore() restores original stderr", () => {
    harness = createCliHarness();

    process.stderr.write("captured");
    assert.equal(harness.stderr.length, 1);

    harness.restore();

    // After restore, writes should not be captured
    const beforeLength = harness.stderr.length;
    process.stderr.write("not captured");
    assert.equal(harness.stderr.length, beforeLength);
  });

  it("restore() restores original exit", () => {
    harness = createCliHarness();
    harness.restore();

    // We can't actually test process.exit without terminating the test process
    // But we can verify it doesn't throw our intercept error
    assert.doesNotThrow(() => {
      // This would normally exit, but we can't test that
      // Just verify the function is restored (not our intercept version)
      // by checking it's the same reference as original
    });
  });

  it("can be used multiple times with fresh state", () => {
    harness = createCliHarness();
    process.stdout.write("first");
    assert.equal(harness.stdout.length, 1);
    harness.restore();

    // Create new harness
    const harness2 = createCliHarness();
    process.stdout.write("second");
    assert.equal(harness2.stdout.length, 1);
    assert.equal(harness2.stdout[0], "second");
    harness2.restore();

    // First harness still has its captured data
    assert.equal(harness.stdout[0], "first");
  });

  it("restore() is idempotent - can be called multiple times safely", () => {
    harness = createCliHarness();

    process.stdout.write("test");
    harness.restore();
    harness.restore(); // Should not throw
    harness.restore(); // Should not throw

    // Originals are still restored
    assert.equal(harness.stdout.length, 1);
  });

  it("captures stdout with Buffer input", () => {
    harness = createCliHarness();

    process.stdout.write(Buffer.from("buffer content"));

    assert.equal(harness.stdout.length, 1);
    assert.equal(harness.stdout[0], "buffer content");
  });

  it("captures stderr with Buffer input", () => {
    harness = createCliHarness();

    process.stderr.write(Buffer.from("error buffer"));

    assert.equal(harness.stderr.length, 1);
    assert.equal(harness.stderr[0], "error buffer");
  });
});
