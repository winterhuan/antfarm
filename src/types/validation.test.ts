import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { isSuccess, isFailure, success, failure } from './validation.js';
import type { ValidationResult } from './validation.js';

describe('validation result', () => {
  it('creates success results', () => {
    const result = success({ id: 'test' });
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.value, { id: 'test' });
  });

  it('creates failure results', () => {
    const result = failure(['error 1'], ['warning 1']);
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(result.errors, ['error 1']);
    assert.deepStrictEqual(result.warnings, ['warning 1']);
  });

  it('creates failure results without warnings', () => {
    const result = failure(['error 1']);
    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(result.errors, ['error 1']);
    assert.deepStrictEqual(result.warnings, []);
  });

  it('narrows success correctly', () => {
    const result: ValidationResult<number> = success(42);
    if (isSuccess(result)) {
      assert.strictEqual(result.value, 42);
    } else {
      assert.fail('Expected success');
    }
  });

  it('narrows failure correctly', () => {
    const result: ValidationResult<number> = failure(['err']);
    if (isFailure(result)) {
      assert.deepStrictEqual(result.errors, ['err']);
    } else {
      assert.fail('Expected failure');
    }
  });

  it('discriminates success from failure', () => {
    const successResult: ValidationResult<string> = success('ok');
    const failureResult: ValidationResult<string> = failure(['error']);

    assert.strictEqual(isSuccess(successResult), true);
    assert.strictEqual(isFailure(successResult), false);

    assert.strictEqual(isSuccess(failureResult), false);
    assert.strictEqual(isFailure(failureResult), true);
  });

  it('handles generic types', () => {
    interface TestData {
      name: string;
      count: number;
    }

    const data: TestData = { name: 'test', count: 5 };
    const result = success(data);
    assert.strictEqual(result.value.name, 'test');
    assert.strictEqual(result.value.count, 5);
  });
});
