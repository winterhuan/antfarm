/**
 * Backend Contract Tests
 *
 * Comprehensive parameterized tests for all 4 backends to ensure they conform
 * to the Backend interface contract with extended lifecycle methods.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createBackend, type Backend, type BackendType } from './index.js';
import type { WorkflowSpec, WorkflowAgent } from '../installer/types.js';

const backends: BackendType[] = ['openclaw', 'hermes', 'claude-code', 'codex'];

// Minimal mock workflow for testing
function createMockWorkflow(): WorkflowSpec {
  return {
    id: 'test-workflow',
    name: 'Test Workflow',
    version: 1,
    defaultBackend: 'openclaw',
    polling: {
      model: 'test-model',
      timeoutSeconds: 1800,
    },
    agents: [
      {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'A test agent',
        role: 'coding',
        model: 'test-model',
        timeoutSeconds: 1800,
        backend: 'openclaw',
        workspace: {
          baseDir: '/tmp/test',
          files: {},
          skills: [],
        },
      },
    ],
    steps: [
      {
        id: 'step-1',
        agent: 'test-agent',
        input: 'Test input',
        expects: 'Test output',
      },
    ],
    context: {},
    notifications: {},
  };
}

// Create mock agent
function createMockAgent(role?: WorkflowAgent['role']): WorkflowAgent {
  return {
    id: 'mock-agent',
    name: 'Mock Agent',
    description: 'A mock agent for testing',
    role: role ?? 'coding',
    model: 'test-model',
    timeoutSeconds: 1800,
    backend: 'openclaw',
    workspace: {
      baseDir: '/tmp/test',
      files: {},
      skills: [],
    },
  };
}

for (const backendType of backends) {
  describe(`${backendType} backend contract`, () => {
    let backend: Backend;

    before(() => {
      backend = createBackend(backendType);
    });

    // ============================================================================
    // Capability Tests
    // ============================================================================

    it('has required capabilities object', () => {
      assert.ok(backend.capabilities, `${backendType} should have capabilities`);
      assert.equal(typeof backend.capabilities, 'object');
    });

    it('supportsPerToolDeny is a boolean', () => {
      assert.equal(
        typeof backend.capabilities.supportsPerToolDeny,
        'boolean',
        `${backendType}.capabilities.supportsPerToolDeny should be boolean`
      );
    });

    it('supportsSandbox is a boolean', () => {
      assert.equal(
        typeof backend.capabilities.supportsSandbox,
        'boolean',
        `${backendType}.capabilities.supportsSandbox should be boolean`
      );
    });

    it('schedulerDriven is a boolean', () => {
      assert.equal(
        typeof backend.capabilities.schedulerDriven,
        'boolean',
        `${backendType}.capabilities.schedulerDriven should be boolean`
      );
    });

    it('supportsCronManagement is a boolean', () => {
      assert.equal(
        typeof backend.capabilities.supportsCronManagement,
        'boolean',
        `${backendType}.capabilities.supportsCronManagement should be boolean`
      );
    });

    // ============================================================================
    // Permission Adapter Tests
    // ============================================================================

    it('has permission adapter', () => {
      assert.ok(backend.permissionAdapter, `${backendType} should have permissionAdapter`);
      assert.equal(typeof backend.permissionAdapter, 'object');
    });

    it('permissionAdapter.applyRoleConstraints is a function', () => {
      assert.equal(
        typeof backend.permissionAdapter.applyRoleConstraints,
        'function',
        `${backendType}.permissionAdapter.applyRoleConstraints should be a function`
      );
    });

    it('permissionAdapter.removeRoleConstraints is a function', () => {
      assert.equal(
        typeof backend.permissionAdapter.removeRoleConstraints,
        'function',
        `${backendType}.permissionAdapter.removeRoleConstraints should be a function`
      );
    });

    // ============================================================================
    // Lifecycle Method Tests
    // ============================================================================

    it('has install method', () => {
      assert.equal(typeof backend.install, 'function', `${backendType} should have install method`);
    });

    it('has uninstall method', () => {
      assert.equal(typeof backend.uninstall, 'function', `${backendType} should have uninstall method`);
    });

    it('has startRun method', () => {
      assert.equal(typeof backend.startRun, 'function', `${backendType} should have startRun method`);
    });

    it('has stopRun method', () => {
      assert.equal(typeof backend.stopRun, 'function', `${backendType} should have stopRun method`);
    });

    it('has configureAgent method', () => {
      assert.equal(typeof backend.configureAgent, 'function', `${backendType} should have configureAgent method`);
    });

    it('has removeAgent method', () => {
      assert.equal(typeof backend.removeAgent, 'function', `${backendType} should have removeAgent method`);
    });

    it('has validate method', () => {
      assert.equal(typeof backend.validate, 'function', `${backendType} should have validate method`);
    });

    // ============================================================================
    // Validate Method Tests
    // ============================================================================

    it('validate returns a ValidationResult', async () => {
      const workflow = createMockWorkflow();
      const result = await backend.validate(workflow);

      assert.ok(result, 'validate should return a result');
      assert.equal(typeof result.valid, 'boolean', 'result.valid should be boolean');
      assert.ok(Array.isArray(result.errors), 'result.errors should be an array');
      assert.ok(Array.isArray(result.warnings), 'result.warnings should be an array');
    });

    it('validate detects duplicate agent IDs', async () => {
      const workflow: WorkflowSpec = {
        ...createMockWorkflow(),
        agents: [
          createMockAgent(),
          { ...createMockAgent(), id: 'mock-agent' }, // Duplicate ID
        ],
      };

      const result = await backend.validate(workflow);
      // Some backends may report this as an error or warning
      assert.ok(result.errors.length > 0 || result.warnings.length > 0 || result.valid === false);
    });

    it('validate handles empty agent ID', async () => {
      const workflow: WorkflowSpec = {
        ...createMockWorkflow(),
        agents: [
          { ...createMockAgent(), id: '' },
        ],
      };

      const result = await backend.validate(workflow);
      // Should have errors for empty agent ID
      assert.ok(!result.valid || result.errors.length > 0 || result.warnings.length > 0);
    });

    // ============================================================================
    // Permission Adapter Tests (Execution)
    // ============================================================================

    it('applyRoleConstraints accepts WorkflowAgent', async () => {
      const agent = createMockAgent('coding');
      // Should not throw
      await assert.doesNotReject(
        async () => await backend.permissionAdapter.applyRoleConstraints(agent),
        `${backendType}.permissionAdapter.applyRoleConstraints should accept WorkflowAgent`
      );
    });

    it('applyRoleConstraints handles different roles', async () => {
      const roles: WorkflowAgent['role'][] = ['coding', 'analysis', 'verification', 'testing', 'pr', 'scanning', undefined];

      for (const role of roles) {
        const agent = createMockAgent(role);
        await assert.doesNotReject(
          async () => await backend.permissionAdapter.applyRoleConstraints(agent),
          `${backendType}.permissionAdapter.applyRoleConstraints should handle role: ${role ?? 'undefined'}`
        );
      }
    });

    it('removeRoleConstraints accepts agentId string', async () => {
      // Should not throw
      await assert.doesNotReject(
        async () => await backend.permissionAdapter.removeRoleConstraints('test-agent'),
        `${backendType}.permissionAdapter.removeRoleConstraints should accept agentId`
      );
    });

    // ============================================================================
    // spawnAgent Tests (Optional - only for scheduler-driven backends)
    // ============================================================================

    it('spawnAgent is optional', () => {
      // spawnAgent is optional, so backends may or may not have it
      if (backend.capabilities.schedulerDriven) {
        assert.equal(
          typeof backend.spawnAgent,
          'function',
          `${backendType} is scheduler-driven so should have spawnAgent`
        );
      }
    });
  });
}

// ============================================================================
// Backend-Specific Capability Tests
// ============================================================================

describe('Backend-specific capabilities', () => {
  it('OpenClaw supports per-tool deny', () => {
    const backend = createBackend('openclaw');
    assert.equal(backend.capabilities.supportsPerToolDeny, true);
    assert.equal(backend.capabilities.supportsCronManagement, true);
    assert.equal(backend.capabilities.schedulerDriven, false);
    assert.equal(backend.capabilities.supportsSandbox, false);
  });

  it('Hermes does not support per-tool deny', () => {
    const backend = createBackend('hermes');
    assert.equal(backend.capabilities.supportsPerToolDeny, false);
    assert.equal(backend.capabilities.supportsCronManagement, true);
    assert.equal(backend.capabilities.schedulerDriven, false);
    assert.equal(backend.capabilities.supportsSandbox, false);
  });

  it('Claude Code supports per-tool deny and is scheduler-driven', () => {
    const backend = createBackend('claude-code');
    assert.equal(backend.capabilities.supportsPerToolDeny, true);
    assert.equal(backend.capabilities.supportsCronManagement, false);
    assert.equal(backend.capabilities.schedulerDriven, true);
    assert.equal(backend.capabilities.supportsSandbox, false);
    assert.equal(typeof backend.spawnAgent, 'function');
  });

  it('Codex supports sandbox and is scheduler-driven', () => {
    const backend = createBackend('codex');
    assert.equal(backend.capabilities.supportsPerToolDeny, false);
    assert.equal(backend.capabilities.supportsCronManagement, false);
    assert.equal(backend.capabilities.schedulerDriven, true);
    assert.equal(backend.capabilities.supportsSandbox, true);
    assert.equal(typeof backend.spawnAgent, 'function');
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Backend error handling', () => {
  it('createBackend throws on unknown type', () => {
    assert.throws(
      () => createBackend('unknown' as BackendType),
      /Unknown backend type/
    );
  });
});
