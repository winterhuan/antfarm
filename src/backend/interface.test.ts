import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBackend, type Backend, type BackendCapabilities, type ValidationResult, type PermissionAdapter, type SpawnResult } from './index.js';

describe('Backend interface', () => {
  it('accepts a Backend-shaped object', () => {
    const backend: Backend = {
      install: async () => {},
      uninstall: async () => {},
      startRun: async () => {},
      stopRun: async () => {},
      configureAgent: async () => {},
      removeAgent: async () => {},
      validate: async () => ({ valid: true, errors: [], warnings: [] }),
      capabilities: {
        supportsPerToolDeny: true,
        supportsSandbox: false,
        schedulerDriven: false,
        supportsCronManagement: true,
      },
      permissionAdapter: {
        applyRoleConstraints: async () => {},
        removeRoleConstraints: async () => {},
      },
    };
    assert.ok(backend);
  });

  it('creates the OpenClaw backend', () => {
    const backend = createBackend('openclaw');
    assert.equal(typeof backend.install, 'function');
    assert.equal(typeof backend.configureAgent, 'function');
    assert.equal(typeof backend.validate, 'function');
    assert.ok(backend.capabilities);
    assert.ok(backend.permissionAdapter);
  });

  it('creates the Hermes backend', () => {
    const backend = createBackend('hermes');
    assert.equal(typeof backend.install, 'function');
    assert.equal(typeof backend.configureAgent, 'function');
    assert.equal(typeof backend.validate, 'function');
    assert.ok(backend.capabilities);
    assert.ok(backend.permissionAdapter);
  });

  it('creates the Claude Code backend', () => {
    const backend = createBackend('claude-code');
    assert.equal(typeof backend.install, 'function');
    assert.equal(typeof backend.configureAgent, 'function');
    assert.equal(typeof backend.validate, 'function');
    assert.ok(backend.capabilities);
    assert.ok(backend.permissionAdapter);
    // Claude Code supports spawnAgent
    assert.equal(typeof backend.spawnAgent, 'function');
  });

  it('creates the Codex backend', () => {
    const backend = createBackend('codex');
    assert.equal(typeof backend.install, 'function');
    assert.equal(typeof backend.configureAgent, 'function');
    assert.equal(typeof backend.validate, 'function');
    assert.ok(backend.capabilities);
    assert.ok(backend.permissionAdapter);
    // Codex supports spawnAgent
    assert.equal(typeof backend.spawnAgent, 'function');
  });

  it('BackendCapabilities has all required flags', () => {
    const caps: BackendCapabilities = {
      supportsPerToolDeny: true,
      supportsSandbox: false,
      schedulerDriven: false,
      supportsCronManagement: true,
    };
    assert.equal(typeof caps.supportsPerToolDeny, 'boolean');
    assert.equal(typeof caps.supportsSandbox, 'boolean');
    assert.equal(typeof caps.schedulerDriven, 'boolean');
    assert.equal(typeof caps.supportsCronManagement, 'boolean');
  });

  it('ValidationResult has all required fields', () => {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: ['test warning'],
    };
    assert.equal(typeof result.valid, 'boolean');
    assert.ok(Array.isArray(result.errors));
    assert.ok(Array.isArray(result.warnings));
  });

  it('PermissionAdapter has all required methods', () => {
    const adapter: PermissionAdapter = {
      applyRoleConstraints: async () => {},
      removeRoleConstraints: async () => {},
    };
    assert.equal(typeof adapter.applyRoleConstraints, 'function');
    assert.equal(typeof adapter.removeRoleConstraints, 'function');
  });

  it('SpawnResult has all required fields', () => {
    const result: SpawnResult = {
      success: true,
      output: 'test output',
      error: undefined,
      exitCode: 0,
    };
    assert.equal(typeof result.success, 'boolean');
  });
});
