import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = join(__dirname, "..", "..", "dist", "cli", "cli.js");

type CliRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  sandboxBlocked: boolean;
};

function runCli(args: string[]): CliRunResult {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const spawnError = result.error as NodeJS.ErrnoException | undefined;
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    sandboxBlocked: spawnError?.code === "EPERM",
  };
}

describe("workflow stop CLI", () => {
  it("help text includes 'workflow stop' command", (t) => {
    const result = runCli([]);
    if (result.sandboxBlocked) t.skip("sandbox disallows spawning node subprocesses");
    const output = result.stdout + result.stderr;
    assert.ok(output.includes("workflow stop"), "Help text should include 'workflow stop'");
    assert.ok(output.includes("Stop/cancel a running workflow"), "Help text should include stop description");
  });

  it("'workflow stop' appears after 'workflow resume' in help text", (t) => {
    const result = runCli([]);
    if (result.sandboxBlocked) t.skip("sandbox disallows spawning node subprocesses");
    const output = result.stdout + result.stderr;
    const resumeIndex = output.indexOf("workflow resume");
    const stopIndex = output.indexOf("workflow stop");
    assert.ok(resumeIndex !== -1, "Help text should include 'workflow resume'");
    assert.ok(stopIndex !== -1, "Help text should include 'workflow stop'");
    assert.ok(stopIndex > resumeIndex, "'workflow stop' should appear after 'workflow resume'");
  });

  it("'workflow stop' with no run-id prints error and exits with code 1", (t) => {
    const result = runCli(["workflow", "stop"]);
    if (result.sandboxBlocked) t.skip("sandbox disallows spawning node subprocesses");
    assert.equal(result.status, 1, "Should exit with code 1");
    assert.ok(
      result.stderr.includes("Missing run-id"),
      "Should print 'Missing run-id' to stderr",
    );
  });

  it("'workflow stop' with nonexistent run-id prints error and exits with code 1", (t) => {
    const result = runCli(["workflow", "stop", "nonexistent-run-id-000"]);
    if (result.sandboxBlocked) t.skip("sandbox disallows spawning node subprocesses");
    assert.equal(result.status, 1, "Should exit with code 1");
    assert.ok(
      result.stderr.length > 0,
      "Should print error to stderr",
    );
  });
});

describe("workflow tick CLI", () => {
  it("help text includes 'workflow tick' command", (t) => {
    const result = runCli([]);
    if (result.sandboxBlocked) t.skip("sandbox disallows spawning node subprocesses");
    const output = result.stdout + result.stderr;
    assert.ok(output.includes("workflow tick"), "Help text should include 'workflow tick'");
    assert.ok(output.includes("Claude/Codex agent"), "Help text should describe workflow tick");
  });

  it("'workflow tick' with no agent-id prints error and exits with code 1", (t) => {
    const result = runCli(["workflow", "tick"]);
    if (result.sandboxBlocked) t.skip("sandbox disallows spawning node subprocesses");
    assert.equal(result.status, 1, "Should exit with code 1");
    assert.ok(
      result.stderr.includes("Missing agent-id"),
      "Should print 'Missing agent-id' to stderr",
    );
  });
});
