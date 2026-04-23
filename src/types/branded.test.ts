import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { workflowId, stepId, runId, agentId, type WorkflowId, type StepId } from './branded.js';

describe('branded types', () => {
  it('creates workflow IDs', () => {
    const id = workflowId('wf-test-123');
    assert.strictEqual(id, 'wf-test-123');
  });

  it('creates step IDs', () => {
    const id = stepId('step-456');
    assert.strictEqual(id, 'step-456');
  });

  it('creates run IDs', () => {
    const id = runId('run-789');
    assert.strictEqual(id, 'run-789');
  });

  it('creates agent IDs', () => {
    const id = agentId('agent-abc');
    assert.strictEqual(id, 'agent-abc');
  });

  it('validates non-empty strings', () => {
    assert.throws(() => workflowId(''), /non-empty/);
    assert.throws(() => workflowId(null as unknown as string), /non-empty/);
    assert.throws(() => stepId(''), /non-empty/);
    assert.throws(() => stepId(null as unknown as string), /non-empty/);
    assert.throws(() => runId(''), /non-empty/);
    assert.throws(() => runId(null as unknown as string), /non-empty/);
    assert.throws(() => agentId(''), /non-empty/);
    assert.throws(() => agentId(null as unknown as string), /non-empty/);
  });

  it('validates undefined values', () => {
    assert.throws(() => workflowId(undefined as unknown as string), /non-empty/);
    assert.throws(() => stepId(undefined as unknown as string), /non-empty/);
    assert.throws(() => runId(undefined as unknown as string), /non-empty/);
    assert.throws(() => agentId(undefined as unknown as string), /non-empty/);
  });

  it('prevents mixing at compile time', () => {
    const wfId: WorkflowId = workflowId('wf-1');
    const stId: StepId = stepId('step-1');
    // This would be a compile error:
    // const wrong: WorkflowId = stId;
    // Verify runtime values are strings
    assert.strictEqual(typeof wfId, 'string');
    assert.strictEqual(typeof stId, 'string');
    // Verify they maintain their string values
    assert.strictEqual(wfId, 'wf-1');
    assert.strictEqual(stId, 'step-1');
  });
});
