/**
 * Antfarm Error Class Hierarchy
 *
 * Error Code Convention:
 * Format: MODULE.ACTION.REASON
 *
 * MODULE: STEP, BACKEND, PROFILE, CONFIG, CLI, TEMPLATE, WORKFLOW
 * ACTION: CLAIM, FAIL, INSTALL, VALIDATE, RETRY, CREATE, DELETE, PARSE, RESOLVE
 * REASON: NOT_FOUND, EXHAUSTED, INVALID, TIMEOUT, ABORTED, EXISTS, MISSING, FAILED
 *
 * Examples:
 * - STEP.CLAIM.NOT_FOUND    - step not found when claiming
 * - STEP.RETRY.EXHAUSTED    - max retries reached
 * - BACKEND.INSTALL.FAILED  - backend installation failed
 * - PROFILE.CREATE.EXISTS   - profile already exists
 * - CONFIG.PARSE.INVALID    - configuration parsing error
 * - CLI.EXEC.ABORTED        - CLI execution aborted
 * - TEMPLATE.RESOLVE.MISSING - template variable missing
 */

export interface AntfarmErrorOptions {
  message: string;
  code: string;
  context?: Record<string, unknown>;
  cause?: Error;
}

/**
 * Base class for all Antfarm errors.
 * All properties are readonly for immutability.
 * Note: Concrete subclasses must call Object.freeze(this) at the end of their constructor.
 */
export class AntfarmError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;
  readonly cause?: Error;
  readonly timestamp: string;

  constructor(opts: AntfarmErrorOptions) {
    super(opts.message);
    this.code = opts.code;
    this.context = Object.freeze({ ...(opts.context ?? {}) });
    this.cause = opts.cause;
    this.timestamp = new Date().toISOString();
    // Freeze concrete instances (when AntfarmError is used directly, not as abstract base)
    if (this.constructor === AntfarmError) {
      Object.freeze(this);
    }
  }

  /**
   * Returns a plain object representation of the error.
   * Useful for structured logging and serialization.
   */
  toJSON(): object {
    return {
      error: true,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      cause: this.cause
        ? {
            message: this.cause.message,
            stack: this.cause.stack,
            ...(this.cause instanceof AntfarmError ? this.cause.toJSON() : {}),
          }
        : undefined,
    };
  }
}

// ============================================================================
// Backend Errors
// ============================================================================

export interface BackendErrorOptions extends AntfarmErrorOptions {
  backendType: string;
  operation: string;
}

/**
 * Base class for backend-related errors.
 * Abstract - do not instantiate directly. Use concrete subclasses.
 */
export abstract class BackendError extends AntfarmError {
  readonly backendType: string;
  readonly operation: string;

  constructor(opts: BackendErrorOptions) {
    super({
      message: opts.message,
      code: opts.code,
      context: opts.context,
      cause: opts.cause,
    });
    this.backendType = opts.backendType;
    this.operation = opts.operation;
  }

  override toJSON(): object {
    return {
      ...super.toJSON(),
      backendType: this.backendType,
      operation: this.operation,
    };
  }
}

export interface ProfileErrorOptions extends BackendErrorOptions {
  profileName: string;
  workflowId: string;
}

/**
 * Error for backend profile operations.
 */
export class ProfileError extends BackendError {
  readonly profileName: string;
  readonly workflowId: string;

  constructor(opts: ProfileErrorOptions) {
    super({
      message: opts.message,
      code: opts.code,
      backendType: opts.backendType,
      operation: opts.operation,
      context: opts.context,
      cause: opts.cause,
    });
    this.profileName = opts.profileName;
    this.workflowId = opts.workflowId;
    Object.freeze(this);
  }

  override toJSON(): object {
    return {
      ...super.toJSON(),
      profileName: this.profileName,
      workflowId: this.workflowId,
    };
  }
}

// ============================================================================
// Step Errors
// ============================================================================

export interface StepErrorOptions extends AntfarmErrorOptions {
  stepId: string;
  runId: string;
  workflowId: string;
}

/**
 * Base class for step-related errors.
 * Abstract - do not instantiate directly. Use concrete subclasses.
 */
export abstract class StepError extends AntfarmError {
  readonly stepId: string;
  readonly runId: string;
  readonly workflowId: string;

  constructor(opts: StepErrorOptions) {
    super({
      message: opts.message,
      code: opts.code,
      context: opts.context,
      cause: opts.cause,
    });
    this.stepId = opts.stepId;
    this.runId = opts.runId;
    this.workflowId = opts.workflowId;
  }

  override toJSON(): object {
    return {
      ...super.toJSON(),
      stepId: this.stepId,
      runId: this.runId,
      workflowId: this.workflowId,
    };
  }
}

export interface StepRetryExhaustedOptions extends StepErrorOptions {
  retryCount: number;
  maxRetries: number;
}

/**
 * Error thrown when step retries are exhausted.
 * Code: STEP.RETRY.EXHAUSTED
 */
export class StepRetryExhausted extends StepError {
  readonly retryCount: number;
  readonly maxRetries: number;

  constructor(opts: StepRetryExhaustedOptions) {
    super({
      message: `Step ${opts.stepId} exhausted retries after ${opts.retryCount} attempts (max: ${opts.maxRetries})`,
      code: "STEP.RETRY.EXHAUSTED",
      context: opts.context,
      cause: opts.cause,
      stepId: opts.stepId,
      runId: opts.runId,
      workflowId: opts.workflowId,
    });
    this.retryCount = opts.retryCount;
    this.maxRetries = opts.maxRetries;
    Object.freeze(this);
  }

  override toJSON(): object {
    return {
      ...super.toJSON(),
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
    };
  }
}

// ============================================================================
// Config Errors
// ============================================================================

/**
 * Base class for configuration-related errors.
 * Abstract - do not instantiate directly. Use concrete subclasses.
 */
export abstract class ConfigError extends AntfarmError {
  constructor(opts: AntfarmErrorOptions) {
    super(opts);
  }
}

// ============================================================================
// CLI Errors
// ============================================================================

export interface CliErrorOptions extends AntfarmErrorOptions {
  exitCode: number;
  userMessage: string;
}

/**
 * Error for CLI-related operations.
 */
export class CliError extends AntfarmError {
  readonly exitCode: number;
  readonly userMessage: string;

  constructor(opts: CliErrorOptions) {
    super({
      message: opts.message,
      code: opts.code,
      context: opts.context,
      cause: opts.cause,
    });
    this.exitCode = opts.exitCode;
    this.userMessage = opts.userMessage;
    Object.freeze(this);
  }

  override toJSON(): object {
    return {
      ...super.toJSON(),
      exitCode: this.exitCode,
      userMessage: this.userMessage,
    };
  }
}

// ============================================================================
// Template Errors
// ============================================================================

export interface TemplateErrorOptions extends AntfarmErrorOptions {
  template: string;
  missingKeys: string[];
}

/**
 * Error for template resolution failures.
 * Code: CONFIG.TEMPLATE.MISSING_KEYS
 */
export class TemplateError extends ConfigError {
  readonly template: string;
  readonly missingKeys: readonly string[];

  constructor(opts: TemplateErrorOptions) {
    super({
      message: `Template missing required keys: ${opts.missingKeys.join(", ")}`,
      code: "CONFIG.TEMPLATE.MISSING_KEYS",
      context: { ...opts.context, template: opts.template },
      cause: opts.cause,
    });
    this.template = opts.template;
    this.missingKeys = Object.freeze([...opts.missingKeys]);
    Object.freeze(this);
  }

  override toJSON(): object {
    return {
      ...super.toJSON(),
      template: this.template,
      missingKeys: [...this.missingKeys],
    };
  }
}

// ============================================================================
// Workflow Errors
// ============================================================================

export interface WorkflowErrorOptions extends AntfarmErrorOptions {
  workflowId: string;
}

/**
 * Error for workflow-related operations.
 */
export class WorkflowError extends AntfarmError {
  readonly workflowId: string;

  constructor(opts: WorkflowErrorOptions) {
    super({
      message: opts.message,
      code: opts.code,
      context: opts.context,
      cause: opts.cause,
    });
    this.workflowId = opts.workflowId;
    Object.freeze(this);
  }

  override toJSON(): object {
    return {
      ...super.toJSON(),
      workflowId: this.workflowId,
    };
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if an error is an AntfarmError instance.
 */
export function isAntfarmError(error: unknown): error is AntfarmError {
  return error instanceof AntfarmError;
}

/**
 * Check if an error is a StepError instance.
 */
export function isStepError(error: unknown): error is StepError {
  return error instanceof StepError;
}

/**
 * Check if an error is a BackendError instance.
 */
export function isBackendError(error: unknown): error is BackendError {
  return error instanceof BackendError;
}

/**
 * Check if an error is a ConfigError instance.
 */
export function isConfigError(error: unknown): error is ConfigError {
  return error instanceof ConfigError;
}
