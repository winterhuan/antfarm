# Task: IMPL-001 Implement AntfarmError class hierarchy foundation

## Implementation Summary

Created the foundation for structured error handling in Antfarm by implementing a complete error class hierarchy in `src/lib/errors.ts`.

### Files Modified
- `src/lib/errors.ts`: New file containing the complete error class hierarchy
- `src/lib/errors.test.ts`: New file with comprehensive unit tests

### Content Added

#### **AntfarmError** (`src/lib/errors.ts:33-71`)
Base class for all Antfarm errors with:
- `readonly code: string` - Error code following MODULE.ACTION.REASON convention
- `readonly context: Record<string, unknown>` - Additional error context
- `readonly cause?: Error` - Original error that caused this error
- `readonly timestamp: string` - ISO timestamp of error creation
- `toJSON(): object` - Structured serialization for logging
- `Object.freeze(this)` - Immutability (only when instantiated directly, not when extended)

#### **BackendError** (`src/lib/errors.ts:89-112`)
Abstract base for backend-related errors:
- `readonly backendType: string` - Backend identifier (hermes, claude-code, codex, openclaw)
- `readonly operation: string` - Operation being performed
- Extends AntfarmError

#### **ProfileError** (`src/lib/errors.ts:114-139`)
Backend profile operation errors:
- `readonly profileName: string` - Profile identifier
- `readonly workflowId: string` - Associated workflow ID
- Extends BackendError
- Code prefix: `PROFILE.*`

#### **StepError** (`src/lib/errors.ts:155-180`)
Abstract base for step execution errors:
- `readonly stepId: string` - Step identifier
- `readonly runId: string` - Run identifier
- `readonly workflowId: string` - Workflow identifier
- Extends AntfarmError

#### **StepRetryExhausted** (`src/lib/errors.ts:191-217`)
Step retry exhaustion error:
- `readonly retryCount: number` - Number of retries attempted
- `readonly maxRetries: number` - Maximum allowed retries
- Extends StepError
- Code: `STEP.RETRY.EXHAUSTED`

#### **ConfigError** (`src/lib/errors.ts:227-231`)
Abstract base for configuration errors:
- Extends AntfarmError
- Code prefix: `CONFIG.*`

#### **CliError** (`src/lib/errors.ts:245-267`)
CLI operation errors:
- `readonly exitCode: number` - Process exit code
- `readonly userMessage: string` - User-friendly error message
- Extends AntfarmError
- Code prefix: `CLI.*`

#### **TemplateError** (`src/lib/errors.ts:279-307`)
Template resolution failures:
- `readonly template: string` - The template string
- `readonly missingKeys: readonly string[]` - Missing template variables
- Extends ConfigError
- Code: `CONFIG.TEMPLATE.MISSING_KEYS`

#### **WorkflowError** (`src/lib/errors.ts:309-337`)
Workflow operation errors:
- `readonly workflowId: string` - Workflow identifier
- Extends AntfarmError
- Code prefix: `WORKFLOW.*`

#### **Type Guards** (`src/lib/errors.ts:349-379`)
Utility functions for type checking:
- `isAntfarmError(error)` - Check if error is AntfarmError
- `isStepError(error)` - Check if error is StepError or subclass
- `isBackendError(error)` - Check if error is BackendError or subclass
- `isConfigError(error)` - Check if error is ConfigError or subclass

### Error Code Convention

Established MODULE.ACTION.REASON format:
- **MODULE**: STEP, BACKEND, PROFILE, CONFIG, CLI, TEMPLATE, WORKFLOW
- **ACTION**: CLAIM, FAIL, INSTALL, VALIDATE, RETRY, CREATE, DELETE, PARSE, RESOLVE
- **REASON**: NOT_FOUND, EXHAUSTED, INVALID, TIMEOUT, ABORTED, EXISTS, MISSING, FAILED

Examples:
- `STEP.CLAIM.NOT_FOUND` - step not found when claiming
- `STEP.RETRY.EXHAUSTED` - max retries reached
- `BACKEND.INSTALL.FAILED` - backend installation failed
- `PROFILE.CREATE.EXISTS` - profile already exists

## Outputs for Dependent Tasks

### Available Components
```typescript
// Import all error classes
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
} from './src/lib/errors.js';

// Create structured errors
throw new StepRetryExhausted({
  stepId: 'step-123',
  runId: 'run-456',
  workflowId: 'wf-789',
  retryCount: 3,
  maxRetries: 3,
});

// Type guard usage
if (isStepError(error)) {
  console.log(error.stepId); // Type-safe access
}
```

### Integration Points

1. **Error Migration in step-ops.ts**:
   - Replace `throw new Error('Step not found')` with `throw new StepError({...})`
   - Replace retry logic with `StepRetryExhausted`
   - Template errors can use `TemplateError` for missing keys

2. **CLI Error Handling in cli.ts**:
   - Replace `process.exit(1)` with `throw new CliError({...})`
   - Use `userMessage` for user-friendly output
   - Use `exitCode` for proper exit handling

3. **Backend Errors**:
   - Use `BackendError` for installation failures
   - Use `ProfileError` for profile management errors

### Usage Examples

```typescript
// Basic error with context
const error = new AntfarmError({
  message: 'Database connection failed',
  code: 'BACKEND.CONNECT.FAILED',
  context: { host: 'localhost', port: 5432 },
  cause: originalError,
});

// Template error
const templateError = new TemplateError({
  template: 'Hello {{name}}',
  missingKeys: ['name'],
});

// CLI error with user-friendly message
const cliError = new CliError({
  message: 'Failed to start daemon',
  code: 'CLI.DAEMON.START_FAILED',
  exitCode: 1,
  userMessage: 'Could not start the dashboard daemon. Check if port 3333 is available.',
});

// Structured logging
console.log(JSON.stringify(error.toJSON()));
```

## Test Results

All 31 tests pass:
- 6 AntfarmError tests (instantiation, context, cause, immutability, toJSON)
- 2 BackendError tests
- 1 ProfileError test
- 2 StepError tests
- 2 StepRetryExhausted tests
- 1 ConfigError test
- 2 CliError tests
- 3 TemplateError tests
- 1 WorkflowError test
- 2 Error Code Format tests
- 4 Type Guard tests
- 5 Subclass relationship tests

### Verification Command
```bash
npx tsc --noEmit src/lib/errors.ts && npx tsx --test src/lib/errors.test.ts
```

## Status: Complete

The error class hierarchy is fully implemented, tested, and ready for integration into dependent tasks.
