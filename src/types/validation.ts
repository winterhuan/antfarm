export interface ValidationSuccess<T> {
  readonly success: true;
  readonly value: T;
}

export interface ValidationFailure {
  readonly success: false;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

// Type guards
export function isSuccess<T>(result: ValidationResult<T>): result is ValidationSuccess<T> {
  return result.success === true;
}

export function isFailure<T>(result: ValidationResult<T>): result is ValidationFailure {
  return result.success === false;
}

// Helper to create success
export function success<T>(value: T): ValidationSuccess<T> {
  return { success: true, value };
}

// Helper to create failure
export function failure(errors: string[], warnings: string[] = []): ValidationFailure {
  return { success: false, errors, warnings };
}
