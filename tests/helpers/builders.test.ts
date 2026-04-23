import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkflowSpec,
  buildWorkflowAgent,
  buildWorkflowStep,
  buildStory,
  buildRunRecord,
  buildBackendSpy,
} from "./builders.js";
import type { WorkflowSpec, WorkflowAgent, WorkflowStep, Story, WorkflowRunRecord } from "../../src/installer/types.js";

describe("buildWorkflowSpec", () => {
  it("returns default values when no overrides provided", () => {
    const spec = buildWorkflowSpec();

    assert.equal(spec.id, "test-workflow");
    assert.equal(spec.name, "Test Workflow");
    assert.equal(spec.version, 1);
    assert.equal(spec.defaultBackend, "hermes");
    assert.deepStrictEqual(spec.agents, []);
    assert.deepStrictEqual(spec.steps, []);
    assert.deepStrictEqual(spec.context, {});
    assert.ok(spec.polling);
    assert.equal(spec.polling?.model, "claude-sonnet-4-6");
  });

  it("applies overrides correctly", () => {
    const overrides: Partial<WorkflowSpec> = {
      id: "custom-workflow",
      name: "Custom Workflow",
      version: 2,
    };
    const spec = buildWorkflowSpec(overrides);

    assert.equal(spec.id, "custom-workflow");
    assert.equal(spec.name, "Custom Workflow");
    assert.equal(spec.version, 2);
    // Other defaults preserved
    assert.equal(spec.defaultBackend, "hermes");
  });

  it("does not share mutable state between calls", () => {
    const spec1 = buildWorkflowSpec({ agents: [{ id: "agent-1", workspace: { baseDir: "/tmp/1", files: {} } }] });
    const spec2 = buildWorkflowSpec();

    // spec2 should not have spec1's agents
    assert.equal(spec2.agents.length, 0);

    // Modifying spec1 should not affect spec2
    spec1.agents.push({ id: "agent-2", workspace: { baseDir: "/tmp/2", files: {} } });
    assert.equal(spec1.agents.length, 2);
    assert.equal(spec2.agents.length, 0);
  });
});

describe("buildWorkflowAgent", () => {
  it("returns default values when no overrides provided", () => {
    const agent = buildWorkflowAgent();

    assert.equal(agent.id, "test-agent");
    assert.equal(agent.name, "Test Agent");
    assert.equal(agent.role, "coding");
    assert.equal(agent.backend, "hermes");
    assert.ok(agent.workspace);
    assert.equal(agent.workspace.baseDir, "/tmp/test-workspace");
  });

  it("applies overrides correctly", () => {
    const overrides: Partial<WorkflowAgent> = {
      id: "custom-agent",
      name: "Custom Agent",
      role: "verification",
    };
    const agent = buildWorkflowAgent(overrides);

    assert.equal(agent.id, "custom-agent");
    assert.equal(agent.name, "Custom Agent");
    assert.equal(agent.role, "verification");
    // Other defaults preserved
    assert.equal(agent.backend, "hermes");
  });

  it("does not share mutable state between calls", () => {
    const agent1 = buildWorkflowAgent({ workspace: { baseDir: "/tmp/custom", files: { "test.txt": "content" } } });
    const agent2 = buildWorkflowAgent();

    // agent2 should have default baseDir
    assert.equal(agent2.workspace.baseDir, "/tmp/test-workspace");
    assert.deepStrictEqual(agent2.workspace.files, {});

    // Modifying agent1 should not affect agent2
    agent1.workspace.files["new.txt"] = "new content";
    assert.equal(agent1.workspace.files["new.txt"], "new content");
    assert.equal(agent2.workspace.files["new.txt"], undefined);
  });
});

describe("buildWorkflowStep", () => {
  it("returns default values when no overrides provided", () => {
    const step = buildWorkflowStep();

    assert.equal(step.id, "test-step");
    assert.equal(step.agent, "test-agent");
    assert.equal(step.type, "single");
    assert.equal(step.input, "Test input prompt");
    assert.equal(step.expects, "Test expected output");
    assert.equal(step.max_retries, 3);
  });

  it("applies overrides correctly", () => {
    const overrides: Partial<WorkflowStep> = {
      id: "custom-step",
      agent: "custom-agent",
      type: "loop",
      input: "Custom input",
    };
    const step = buildWorkflowStep(overrides);

    assert.equal(step.id, "custom-step");
    assert.equal(step.agent, "custom-agent");
    assert.equal(step.type, "loop");
    assert.equal(step.input, "Custom input");
    // Other defaults preserved
    assert.equal(step.expects, "Test expected output");
  });

  it("does not share mutable state between calls", () => {
    const step1 = buildWorkflowStep({
      on_fail: {
        retry_step: "retry-1",
        max_retries: 5,
      },
    });
    const step2 = buildWorkflowStep();

    // step2 should not have step1's on_fail
    assert.equal(step2.on_fail, undefined);

    // Modifying step1 should not affect step2
    if (step1.on_fail) {
      step1.on_fail.max_retries = 10;
    }
    assert.equal(step1.on_fail?.max_retries, 10);
    assert.equal(step2.on_fail, undefined);
  });
});

describe("buildStory", () => {
  it("returns default values when no overrides provided", () => {
    const story = buildStory();

    assert.ok(story.id.startsWith("story-"));
    assert.equal(story.runId, "run-test-001");
    assert.equal(story.storyIndex, 0);
    assert.equal(story.storyId, "story-001");
    assert.equal(story.title, "Test Story");
    assert.equal(story.status, "pending");
    assert.equal(story.retryCount, 0);
    assert.equal(story.maxRetries, 3);
    assert.deepStrictEqual(story.acceptanceCriteria, ["Criterion 1", "Criterion 2"]);
  });

  it("applies overrides correctly", () => {
    const overrides: Partial<Story> = {
      title: "Custom Story",
      status: "running",
      storyIndex: 5,
    };
    const story = buildStory(overrides);

    assert.equal(story.title, "Custom Story");
    assert.equal(story.status, "running");
    assert.equal(story.storyIndex, 5);
    // Other defaults preserved
    assert.equal(story.runId, "run-test-001");
  });

  it("does not share mutable state between calls", () => {
    const story1 = buildStory({ acceptanceCriteria: ["Custom 1", "Custom 2"] });
    const story2 = buildStory();

    // story2 should have default criteria
    assert.deepStrictEqual(story2.acceptanceCriteria, ["Criterion 1", "Criterion 2"]);

    // Modifying story1 should not affect story2
    story1.acceptanceCriteria.push("Custom 3");
    assert.equal(story1.acceptanceCriteria.length, 3);
    assert.equal(story2.acceptanceCriteria.length, 2);
  });
});

describe("buildRunRecord", () => {
  it("returns default values when no overrides provided", () => {
    const record = buildRunRecord();

    assert.equal(record.id, "run-test-001");
    assert.equal(record.workflowId, "test-workflow");
    assert.equal(record.status, "running");
    assert.equal(record.leadAgentId, "test-agent");
    assert.equal(record.currentStepIndex, 0);
    assert.equal(record.retryCount, 0);
    assert.deepStrictEqual(record.stepResults, []);
    assert.deepStrictEqual(record.context, {});
    assert.ok(record.createdAt);
    assert.ok(record.updatedAt);
  });

  it("applies overrides correctly", () => {
    const overrides: Partial<WorkflowRunRecord> = {
      id: "custom-run",
      status: "completed",
      currentStepIndex: 5,
    };
    const record = buildRunRecord(overrides);

    assert.equal(record.id, "custom-run");
    assert.equal(record.status, "completed");
    assert.equal(record.currentStepIndex, 5);
    // Other defaults preserved
    assert.equal(record.workflowId, "test-workflow");
  });

  it("does not share mutable state between calls", () => {
    const record1 = buildRunRecord({
      stepResults: [{ stepId: "step-1", agentId: "agent-1", output: "out", status: "done", completedAt: "2024-01-01" }],
    });
    const record2 = buildRunRecord();

    // record2 should have empty stepResults
    assert.deepStrictEqual(record2.stepResults, []);

    // Modifying record1 should not affect record2
    record1.stepResults.push({ stepId: "step-2", agentId: "agent-2", output: "out2", status: "done", completedAt: "2024-01-02" });
    assert.equal(record1.stepResults.length, 2);
    assert.equal(record2.stepResults.length, 0);
  });

  it("preserves deep context clone", () => {
    const record1 = buildRunRecord({ context: { key: "value" } });
    const record2 = buildRunRecord();

    // record2 should have empty context
    assert.deepStrictEqual(record2.context, {});

    // Modifying record1 context should not affect record2
    record1.context["newKey"] = "newValue";
    assert.equal(record1.context["newKey"], "newValue");
    assert.equal(record2.context["newKey"], undefined);
  });
});

describe("buildBackendSpy", () => {
  it("returns a spy with all methods", () => {
    const spy = buildBackendSpy();

    assert.ok(spy.install);
    assert.ok(spy.uninstall);
    assert.ok(spy.startRun);
    assert.ok(spy.stopRun);
    assert.ok(spy.reset);
  });

  it("captures install calls", async () => {
    const spy = buildBackendSpy();
    const workflow = buildWorkflowSpec();

    await spy.install(workflow, "/tmp/source");

    assert.equal(spy.installCalls.length, 1);
    assert.equal(spy.installCalls[0].workflow.id, "test-workflow");
    assert.equal(spy.installCalls[0].sourceDir, "/tmp/source");
  });

  it("captures uninstall calls", async () => {
    const spy = buildBackendSpy();

    await spy.uninstall("workflow-1");
    await spy.uninstall("workflow-2");

    assert.equal(spy.uninstallCalls.length, 2);
    assert.equal(spy.uninstallCalls[0].workflowId, "workflow-1");
    assert.equal(spy.uninstallCalls[1].workflowId, "workflow-2");
  });

  it("captures startRun calls", async () => {
    const spy = buildBackendSpy();
    const workflow = buildWorkflowSpec({ id: "wf-1" });

    await spy.startRun(workflow);

    assert.equal(spy.startRunCalls.length, 1);
    assert.equal(spy.startRunCalls[0].workflow.id, "wf-1");
  });

  it("captures stopRun calls", async () => {
    const spy = buildBackendSpy();
    const workflow = buildWorkflowSpec({ id: "wf-2" });

    await spy.stopRun(workflow);

    assert.equal(spy.stopRunCalls.length, 1);
    assert.equal(spy.stopRunCalls[0].workflow.id, "wf-2");
  });

  it("reset clears all calls", async () => {
    const spy = buildBackendSpy();

    await spy.install(buildWorkflowSpec(), "/tmp");
    await spy.uninstall("wf-1");
    await spy.startRun(buildWorkflowSpec());
    await spy.stopRun(buildWorkflowSpec());

    spy.reset();

    assert.equal(spy.installCalls.length, 0);
    assert.equal(spy.uninstallCalls.length, 0);
    assert.equal(spy.startRunCalls.length, 0);
    assert.equal(spy.stopRunCalls.length, 0);
  });
});
