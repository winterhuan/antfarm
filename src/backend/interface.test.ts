import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBackend, type Backend } from './index.js';

describe('Backend interface', () => {
  it('accepts a Backend-shaped object', () => {
    const backend: Backend = {
      install: async () => {},
      uninstall: async () => {},
      startRun: async () => {},
      stopRun: async () => {},
    };
    assert.ok(backend);
  });

  it('creates the OpenClaw backend', () => {
    const backend = createBackend('openclaw');
    assert.equal(typeof backend.install, 'function');
  });

  it('creates the Hermes backend', () => {
    const backend = createBackend('hermes');
    assert.equal(typeof backend.install, 'function');
  });

  it('creates the Claude Code backend', () => {
    const backend = createBackend('claude-code');
    assert.equal(typeof backend.install, 'function');
  });

  it('creates the Codex backend', () => {
    const backend = createBackend('codex');
    assert.equal(typeof backend.install, 'function');
  });
});
