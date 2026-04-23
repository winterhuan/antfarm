import {
  AntfarmError,
  BackendError,
  ProfileError,
  StepError,
  StepRetryExhausted,
  ConfigError,
  CliError,
  TemplateError,
  WorkflowError,
  isAntfarmError,
  isStepError,
  isBackendError,
  isConfigError,
} from "./errors.js";
import { describe, it } from "node:test";
import assert from "node:assert";

describe("AntfarmError", () => {
  it("can be instantiated with basic options", () => {
    const error = new AntfarmError({
      message: "Test error",
      code: "TEST.ERROR.CODE",
    });

    assert.strictEqual(error.message, "Test error");
    assert.strictEqual(error.code, "TEST.ERROR.CODE");
    assert.deepStrictEqual(error.context, {});
    assert.strictEqual(error.cause, undefined);
    assert.ok(error.timestamp);
    assert.ok(Date.parse(error.timestamp)); // Valid ISO timestamp
  });

  it("can include context", () => {
    const context = { key: "value", num: 42 };
    const error = new AntfarmError({
      message: "Test error",
      code: "TEST.ERROR.WITH_CONTEXT",
      context,
    });

    assert.deepStrictEqual(error.context, context);
  });

  it("can have a cause", () => {
    const cause = new Error("Original error");
    const error = new AntfarmError({
      message: "Wrapped error",
      code: "TEST.ERROR.WRAPPED",
      cause,
    });

    assert.strictEqual(error.cause, cause);
  });

  it("is frozen and immutable", () => {
    const error = new AntfarmError({
      message: "Test error",
      code: "TEST.ERROR.FROZEN",
    });

    assert.throws(() => {
      (error as any).code = "MODIFIED";
    }, /Cannot assign to read only property/);

    assert.throws(() => {
      (error as any).message = "Modified";
    }, /Cannot assign to read only property/);
  });

  it("toJSON returns correct structure", () => {
    const context = { foo: "bar" };
    const error = new AntfarmError({
      message: "Test error",
      code: "TEST.JSON",
      context,
    });

    const json = error.toJSON() as any;
    assert.strictEqual(json.error, true);
    assert.strictEqual(json.code, "TEST.JSON");
    assert.strictEqual(json.message, "Test error");
    assert.deepStrictEqual(json.context, context);
    assert.ok(json.timestamp);
    assert.strictEqual(json.cause, undefined);
  });

  it("toJSON includes cause details", () => {
    const cause = new Error("Original error");
    const error = new AntfarmError({
      message: "Wrapped error",
      code: "TEST.WRAPPED",
      cause,
    });

    const json = error.toJSON() as any;
    assert.ok(json.cause);
    assert.strictEqual(json.cause.message, "Original error");
    assert.ok(json.cause.stack);
  });
});

describe("BackendError", () => {
  it("can be instantiated", () => {
    const error = new BackendError({
      message: "Backend failed",
      code: "BACKEND.INSTALL.FAILED",
      backendType: "hermes",
      operation: "install",
    });

    assert.strictEqual(error.backendType, "hermes");
    assert.strictEqual(error.operation, "install");
    assert.ok(error instanceof AntfarmError);
    assert.ok(error instanceof BackendError);
  });

  it("toJSON includes backend-specific fields", () => {
    const error = new BackendError({
      message: "Backend failed",
      code: "BACKEND.INSTALL.FAILED",
      backendType: "hermes",
      operation: "install",
    });

    const json = error.toJSON() as any;
    assert.strictEqual(json.backendType, "hermes");
    assert.strictEqual(json.operation, "install");
    assert.strictEqual(json.code, "BACKEND.INSTALL.FAILED");
  });
});

describe("ProfileError", () => {
  it("can be instantiated", () => {
    const error = new ProfileError({
      message: "Profile not found",
      code: "PROFILE.CREATE.EXISTS",
      backendType: "hermes",
      operation: "create",
      profileName: "my-profile",
      workflowId: "test-workflow",
    });

    assert.strictEqual(error.backendType, "hermes");
    assert.strictEqual(error.profileName, "my-profile");
    assert.strictEqual(error.workflowId, "test-workflow");
    assert.ok(error instanceof BackendError);
    assert.ok(error instanceof ProfileError);
  });
});

describe("StepError", () => {
  it("can be instantiated", () => {
    const error = new StepError({
      message: "Step not found",
      code: "STEP.CLAIM.NOT_FOUND",
      stepId: "step-123",
      runId: "run-456",
      workflowId: "wf-789",
    });

    assert.strictEqual(error.stepId, "step-123");
    assert.strictEqual(error.runId, "run-456");
    assert.strictEqual(error.workflowId, "wf-789");
    assert.ok(error instanceof AntfarmError);
    assert.ok(error instanceof StepError);
  });

  it("toJSON includes step-specific fields", () => {
    const error = new StepError({
      message: "Step not found",
      code: "STEP.CLAIM.NOT_FOUND",
      stepId: "step-123",
      runId: "run-456",
      workflowId: "wf-789",
    });

    const json = error.toJSON() as any;
    assert.strictEqual(json.stepId, "step-123");
    assert.strictEqual(json.runId, "run-456");
    assert.strictEqual(json.workflowId, "wf-789");
  });
});

describe("StepRetryExhausted", () => {
  it("has auto-generated message with retry details", () => {
    const error = new StepRetryExhausted({
      stepId: "step-123",
      runId: "run-456",
      workflowId: "wf-789",
      retryCount: 3,
      maxRetries: 3,
    });

    assert.strictEqual(error.code, "STEP.RETRY.EXHAUSTED");
    assert.ok(error.message.includes("step-123"));
    assert.ok(error.message.includes("3"));
    assert.strictEqual(error.retryCount, 3);
    assert.strictEqual(error.maxRetries, 3);
  });

  it("is frozen", () => {
    const error = new StepRetryExhausted({
      stepId: "step-123",
      runId: "run-456",
      workflowId: "wf-789",
      retryCount: 3,
      maxRetries: 3,
    });

    assert.throws(() => {
      (error as any).retryCount = 10;
    }, /Cannot assign to read only property/);
  });
});

describe("ConfigError", () => {
  it("can be instantiated", () => {
    const error = new ConfigError({
      message: "Invalid config",
      code: "CONFIG.PARSE.INVALID",
    });

    assert.ok(error instanceof AntfarmError);
    assert.ok(error instanceof ConfigError);
  });
});

describe("CliError", () => {
  it("can be instantiated", () => {
    const error = new CliError({
      message: "CLI execution failed",
      code: "CLI.EXEC.ABORTED",
      exitCode: 1,
      userMessage: "The command was aborted by the user",
    });

    assert.strictEqual(error.exitCode, 1);
    assert.strictEqual(error.userMessage, "The command was aborted by the user");
    assert.ok(error instanceof AntfarmError);
    assert.ok(error instanceof CliError);
  });

  it("toJSON includes CLI-specific fields", () => {
    const error = new CliError({
      message: "CLI execution failed",
      code: "CLI.EXEC.ABORTED",
      exitCode: 1,
      userMessage: "The command was aborted by the user",
    });

    const json = error.toJSON() as any;
    assert.strictEqual(json.exitCode, 1);
    assert.strictEqual(json.userMessage, "The command was aborted by the user");
  });
});

describe("TemplateError", () => {
  it("has auto-generated message with missing keys", () => {
    const error = new TemplateError({
      template: "Hello {{name}}, your {{item}} is ready",
      missingKeys: ["name", "item"],
    });

    assert.strictEqual(error.code, "CONFIG.TEMPLATE.MISSING_KEYS");
    assert.ok(error.message.includes("name"));
    assert.ok(error.message.includes("item"));
    assert.deepStrictEqual(error.missingKeys, ["name", "item"]);
  });

  it("is an instance of ConfigError", () => {
    const error = new TemplateError({
      template: "Hello {{name}}",
      missingKeys: ["name"],
    });

    assert.ok(error instanceof ConfigError);
    assert.ok(error instanceof AntfarmError);
  });

  it("missingKeys array is immutable", () => {
    const error = new TemplateError({
      template: "Hello {{name}}",
      missingKeys: ["name"],
    });

    // The frozen object prevents modifying the reference
    assert.throws(() => {
      (error as any).missingKeys = ["other"];
    }, /Cannot assign to read only property/);

    // But we need to check that internal mutation didn't affect it
    assert.deepStrictEqual(error.missingKeys, ["name"]);
  });
});

describe("WorkflowError", () => {
  it("can be instantiated", () => {
    const error = new WorkflowError({
      message: "Workflow not found",
      code: "WORKFLOW.LOAD.NOT_FOUND",
      workflowId: "test-workflow",
    });

    assert.strictEqual(error.workflowId, "test-workflow");
    assert.ok(error instanceof AntfarmError);
    assert.ok(error instanceof WorkflowError);
  });
});

describe("Error Code Format", () => {
  const validCodes = [
    "STEP.CLAIM.NOT_FOUND",
    "STEP.RETRY.EXHAUSTED",
    "BACKEND.INSTALL.FAILED",
    "PROFILE.CREATE.EXISTS",
    "CONFIG.PARSE.INVALID",
    "CLI.EXEC.ABORTED",
    "CONFIG.TEMPLATE.MISSING_KEYS",
    "WORKFLOW.LOAD.NOT_FOUND",
  ];

  const validCodePattern = /^[A-Z]+\.[A-Z_]+\.[A-Z_]+$/;

  it("all standard error codes follow MODULE.ACTION.REASON pattern", () => {
    for (const code of validCodes) {
      assert.match(code, validCodePattern, `Code ${code} should match pattern`);
    }
  });

  it("errors can be created with custom codes that follow the pattern", () => {
    const error = new AntfarmError({
      message: "Custom error",
      code: "CUSTOM.ACTION.REASON",
    });

    assert.match(error.code, validCodePattern);
  });
});

describe("Type Guards", () => {
  it("isAntfarmError returns true for AntfarmError instances", () => {
    const error = new AntfarmError({ message: "Test", code: "TEST.CODE" });
    assert.strictEqual(isAntfarmError(error), true);
    assert.strictEqual(isAntfarmError(new Error("plain")), false);
  });

  it("isStepError returns true for StepError and subclasses", () => {
    const stepError = new StepError({
      message: "Test",
      code: "STEP.CODE",
      stepId: "s1",
      runId: "r1",
      workflowId: "w1",
    });
    const retryError = new StepRetryExhausted({
      stepId: "s1",
      runId: "r1",
      workflowId: "w1",
      retryCount: 3,
      maxRetries: 3,
    });

    assert.strictEqual(isStepError(stepError), true);
    assert.strictEqual(isStepError(retryError), true);
    assert.strictEqual(isStepError(new AntfarmError({ message: "Test", code: "TEST.CODE" })), false);
  });

  it("isBackendError returns true for BackendError and subclasses", () => {
    const backendError = new BackendError({
      message: "Test",
      code: "BACKEND.CODE",
      backendType: "hermes",
      operation: "test",
    });
    const profileError = new ProfileError({
      message: "Test",
      code: "PROFILE.CODE",
      backendType: "hermes",
      operation: "test",
      profileName: "p1",
      workflowId: "w1",
    });

    assert.strictEqual(isBackendError(backendError), true);
    assert.strictEqual(isBackendError(profileError), true);
    assert.strictEqual(isBackendError(new AntfarmError({ message: "Test", code: "TEST.CODE" })), false);
  });

  it("isConfigError returns true for ConfigError and subclasses", () => {
    const configError = new ConfigError({ message: "Test", code: "CONFIG.CODE" });
    const templateError = new TemplateError({
      template: "{{x}}",
      missingKeys: ["x"],
    });

    assert.strictEqual(isConfigError(configError), true);
    assert.strictEqual(isConfigError(templateError), true);
    assert.strictEqual(isConfigError(new AntfarmError({ message: "Test", code: "TEST.CODE" })), false);
  });
});

describe("Subclass relationships", () => {
  it("BackendError extends AntfarmError", () => {
    const error = new BackendError({
      message: "Test",
      code: "BACKEND.CODE",
      backendType: "hermes",
      operation: "test",
    });
    assert.ok(error instanceof AntfarmError);
    assert.ok(error instanceof BackendError);
  });

  it("ProfileError extends BackendError", () => {
    const error = new ProfileError({
      message: "Test",
      code: "PROFILE.CODE",
      backendType: "hermes",
      operation: "test",
      profileName: "p1",
      workflowId: "w1",
    });
    assert.ok(error instanceof AntfarmError);
    assert.ok(error instanceof BackendError);
    assert.ok(error instanceof ProfileError);
  });

  it("StepError extends AntfarmError", () => {
    const error = new StepError({
      message: "Test",
      code: "STEP.CODE",
      stepId: "s1",
      runId: "r1",
      workflowId: "w1",
    });
    assert.ok(error instanceof AntfarmError);
    assert.ok(error instanceof StepError);
  });

  it("StepRetryExhausted extends StepError", () => {
    const error = new StepRetryExhausted({
      stepId: "s1",
      runId: "r1",
      workflowId: "w1",
      retryCount: 3,
      maxRetries: 3,
    });
    assert.ok(error instanceof AntfarmError);
    assert.ok(error instanceof StepError);
    assert.ok(error instanceof StepRetryExhausted);
  });

  it("TemplateError extends ConfigError", () => {
    const error = new TemplateError({
      template: "{{x}}",
      missingKeys: ["x"],
    });
    assert.ok(error instanceof AntfarmError);
    assert.ok(error instanceof ConfigError);
    assert.ok(error instanceof TemplateError);
  });
});
