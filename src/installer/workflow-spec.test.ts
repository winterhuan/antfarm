import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadWorkflowSpec } from "./workflow-spec.js";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

async function writeWorkflow(baseDir: string): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "antfarm-workflow-spec-"));
  await fs.writeFile(
    path.join(tmpDir, "workflow.yml"),
    [
      "id: demo",
      "agents:",
      "  - id: planner",
      `    workspace:`,
      `      baseDir: ${JSON.stringify(baseDir)}`,
      "      files:",
      "        AGENTS.md: bootstrap.md",
      "steps:",
      "  - id: plan",
      "    agent: planner",
      "    input: do work",
      "    expects: done",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(path.join(tmpDir, "bootstrap.md"), "# bootstrap\n", "utf-8");
  return tmpDir;
}

describe("loadWorkflowSpec", () => {
  it("rejects workspace.baseDir path traversal", async () => {
    const workflowDir = await writeWorkflow("../escape");
    await assert.rejects(
      loadWorkflowSpec(workflowDir),
      /workspace\.baseDir.*must not escape/i,
    );
  });

  it("rejects absolute workspace.baseDir values", async () => {
    const workflowDir = await writeWorkflow("/tmp/escape");
    await assert.rejects(
      loadWorkflowSpec(workflowDir),
      /workspace\.baseDir.*must not be absolute/i,
    );
  });
});
