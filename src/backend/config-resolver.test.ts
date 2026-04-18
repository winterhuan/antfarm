import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBackendType } from './config-resolver.js';

describe('validateBackendType', () => {
  it('accepts openclaw', () => {
    assert.equal(validateBackendType('openclaw'), 'openclaw');
  });
  it('accepts hermes', () => {
    assert.equal(validateBackendType('hermes'), 'hermes');
  });
  it('accepts claude-code', () => {
    assert.equal(validateBackendType('claude-code'), 'claude-code');
  });
  it('rejects unknown backends', () => {
    assert.throws(() => validateBackendType('nope'), /Unknown backend type/);
  });
});
