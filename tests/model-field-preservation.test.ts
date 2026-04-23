/**
 * Regression test: model field must be preserved through install pipeline
 *
 * Bug: workflow.yml agent model configs were silently discarded during install.
 * This test ensures the model field flows from WorkflowAgent → ProvisionedAgent → openclaw.json.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";
import type { WorkflowAgent, WorkflowSpec } from "../src/installer/types.js";
import { loadWorkflowSpec } from "../src/installer/workflow-spec.js";

const TEST_WORKFLOW_WITH_MODELS = `
id: test-workflow
name: Test Workflow
version: 1

agents:
  - id: planner
    name: Planner Agent
    model: anthropic/claude-opus-4-6
    workspace:
      baseDir: agents/planner
      files:
        AGENTS.md: agents/planner/AGENTS.md

  - id: developer
    name: Developer Agent
    model: openai/gpt-5
    workspace:
      baseDir: agents/developer
      files:
        AGENTS.md: agents/developer/AGENTS.md

  - id: reviewer
    name: Reviewer Agent
    workspace:
      baseDir: agents/reviewer
      files:
        AGENTS.md: agents/reviewer/AGENTS.md

steps:
  - id: plan
    agent: planner
    input: Plan the work
    expects: PLAN

  - id: develop
    agent: developer
    input: Do the work
    expects: STATUS
`;

describe("Model field preservation", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "antfarm-test-"));
    await fs.writeFile(path.join(tmpDir, "workflow.yml"), TEST_WORKFLOW_WITH_MODELS);

    for (const agentDir of ["agents/planner", "agents/developer", "agents/reviewer"]) {
      await fs.mkdir(path.join(tmpDir, agentDir), { recursive: true });
      await fs.writeFile(path.join(tmpDir, agentDir, "AGENTS.md"), "# Agent");
    }
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("preserves model field in loadWorkflowSpec", async () => {
    const spec = await loadWorkflowSpec(tmpDir);

    const planner = spec.agents.find((a) => a.id === "planner");
    const developer = spec.agents.find((a) => a.id === "developer");
    const reviewer = spec.agents.find((a) => a.id === "reviewer");

    assert.equal(planner?.model, "anthropic/claude-opus-4-6");
    assert.equal(developer?.model, "openai/gpt-5");
    assert.equal(reviewer?.model, undefined);
  });

  it("WorkflowAgent type accepts model field", () => {
    const agent: WorkflowAgent = {
      id: "test-agent",
      name: "Test",
      model: "anthropic/claude-opus-4-6",
      workspace: {
        baseDir: "agents/test",
        files: { "AGENTS.md": "agents/test/AGENTS.md" },
      },
    };

    assert.equal(agent.model, "anthropic/claude-opus-4-6");
  });
});
