import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_SANDBOX,
  getCodexSandboxMode,
  buildRoleDeveloperInstructions,
} from './codex-policy.js';

describe('getCodexSandboxMode', () => {
  it('maps analysis to workspace-write so it can report step results', () => {
    assert.equal(getCodexSandboxMode('analysis'), 'workspace-write');
  });
  it('maps coding to workspace-write', () => {
    assert.equal(getCodexSandboxMode('coding'), 'workspace-write');
  });
  it('maps verification to workspace-write so it can report step results', () => {
    assert.equal(getCodexSandboxMode('verification'), 'workspace-write');
  });
  it('maps testing to workspace-write', () => {
    assert.equal(getCodexSandboxMode('testing'), 'workspace-write');
  });
  it('maps pr to workspace-write so it can report step results', () => {
    assert.equal(getCodexSandboxMode('pr'), 'workspace-write');
  });
  it('maps scanning to workspace-write so it can report step results', () => {
    assert.equal(getCodexSandboxMode('scanning'), 'workspace-write');
  });
  it('undefined role defaults to workspace-write (coding)', () => {
    assert.equal(getCodexSandboxMode(undefined), 'workspace-write');
  });
});

describe('buildRoleDeveloperInstructions', () => {
  it('includes workflow + agent id + role in the text', () => {
    const text = buildRoleDeveloperInstructions('verification', 'feature-dev', 'verifier');
    assert.match(text, /feature-dev/);
    assert.match(text, /verifier/);
    assert.match(text, /verification/);
  });
  it('for non-coding roles, states the repo must not be modified', () => {
    const text = buildRoleDeveloperInstructions('verification', 'wf', 'a');
    assert.match(text, /MUST NOT modify repository files|workspace-write/i);
  });
  it('for coding role, does not inject read-only guardrail', () => {
    const text = buildRoleDeveloperInstructions('coding', 'wf', 'a');
    assert.doesNotMatch(text, /DO NOT call write_file/i);
  });
});

describe('ROLE_SANDBOX', () => {
  it('covers all AgentRole variants', () => {
    const roles = ['analysis', 'coding', 'verification', 'testing', 'pr', 'scanning'] as const;
    for (const r of roles) {
      assert.ok(r in ROLE_SANDBOX, `missing role ${r}`);
    }
  });
});
