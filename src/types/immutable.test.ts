/**
 * Immutability Utilities Tests
 *
 * Tests for freeze, freezeArray, and immutable type utilities.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { freeze, freezeArray, type DeepReadonly } from "./immutable.js";

describe("immutability utilities", () => {
  it("freeze prevents mutation of top-level properties", () => {
    const obj = freeze({ a: 1, b: 2 });
    assert.throws(() => {
      (obj as any).a = 2;
    }, /Cannot assign to read only property/);
  });

  it("freeze prevents mutation of nested objects", () => {
    const obj = freeze({ nested: { value: 1 } });
    assert.throws(() => {
      (obj.nested as any).value = 2;
    }, /Cannot assign to read only property/);
  });

  it("freezeArray returns frozen array", () => {
    const arr = freezeArray([{ a: 1 }, { b: 2 }]);
    assert.throws(() => {
      (arr as any).push({ c: 3 });
    }, /Cannot add property/);
  });

  it("freezeArray freezes array elements", () => {
    const arr = freezeArray([{ value: 1 }]);
    assert.throws(() => {
      (arr[0] as any).value = 2;
    }, /Cannot assign to read only property/);
  });

  it("freeze preserves primitive values", () => {
    const obj = freeze({ str: "hello", num: 42, bool: true, nil: null });
    assert.strictEqual(obj.str, "hello");
    assert.strictEqual(obj.num, 42);
    assert.strictEqual(obj.bool, true);
    assert.strictEqual(obj.nil, null);
  });

  it("freeze works with arrays inside objects", () => {
    const obj = freeze({ items: [1, 2, 3] });
    assert.deepStrictEqual(obj.items, [1, 2, 3]);
    assert.throws(() => {
      (obj.items as any).push(4);
    }, /Cannot add property/);
  });
});
