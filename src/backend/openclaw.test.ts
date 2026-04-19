import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OpenClawBackend } from './openclaw.js';

describe('OpenClawBackend', () => {
  it('creates an instance', () => {
    const backend = new OpenClawBackend();
    assert.ok(backend);
  });

  it('exposes the required backend methods', () => {
    const backend = new OpenClawBackend();
    assert.equal(typeof backend.install, 'function');
    assert.equal(typeof backend.uninstall, 'function');
    assert.equal(typeof backend.startRun, 'function');
    assert.equal(typeof backend.stopRun, 'function');
  });
});
