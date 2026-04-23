/**
 * Immutability Utilities
 *
 * Core types and utilities for enforcing immutability throughout the codebase.
 * See CLAUDE.md "Immutability (CRITICAL)" - ALWAYS create new objects, NEVER mutate existing ones.
 */

/**
 * Remove readonly recursively for construction.
 * Use this type only when building objects before freezing.
 */
export type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K];
};

/**
 * Deep readonly for complete immutability.
 * All nested objects become recursively readonly.
 */
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};

/**
 * Freeze helper that preserves type and recursively freezes nested objects.
 * Returns a deeply frozen version of the object with proper typing.
 */
export function freeze<T>(obj: T): DeepReadonly<T> {
  if (obj === null || obj === undefined) {
    return obj as DeepReadonly<T>;
  }

  if (typeof obj !== "object") {
    return obj as DeepReadonly<T>;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    const frozenElements = obj.map(freeze);
    return Object.freeze(frozenElements) as DeepReadonly<T>;
  }

  // Handle objects
  const frozenObj: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    frozenObj[key] = freeze((obj as Record<string, unknown>)[key]);
  }
  return Object.freeze(frozenObj) as DeepReadonly<T>;
}

/**
 * Freeze array helper.
 * Returns a readonly array with frozen elements.
 */
export function freezeArray<T>(arr: T[]): ReadonlyArray<DeepReadonly<T>> {
  return Object.freeze(arr.map(freeze)) as ReadonlyArray<DeepReadonly<T>>;
}

/**
 * Merge objects immutably.
 * Creates a new object by spreading all sources.
 */
export function merge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Array<Partial<T>>
): T {
  return { ...target, ...sources.reduce((acc, s) => ({ ...acc, ...s }), {}) };
}
