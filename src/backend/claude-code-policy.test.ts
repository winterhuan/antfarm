import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDisallowedTools, ROLE_DISALLOWED_TOOLS } from './claude-code-policy.js';

describe('buildDisallowedTools', () => {
  it('returns comma-separated write tools for analysis role', () => {
    assert.equal(buildDisallowedTools('analysis'), 'Write,Edit,MultiEdit,NotebookEdit');
  });
  it('returns empty string for coding role (no restrictions)', () => {
    assert.equal(buildDisallowedTools('coding'), '');
  });
  it('returns write tools for verification role', () => {
    assert.equal(buildDisallowedTools('verification'), 'Write,Edit,MultiEdit,NotebookEdit');
  });
  it('testing role allows NotebookEdit but denies Write/Edit/MultiEdit', () => {
    assert.equal(buildDisallowedTools('testing'), 'Write,Edit,MultiEdit');
  });
  it('pr role denies all write tools', () => {
    assert.equal(buildDisallowedTools('pr'), 'Write,Edit,MultiEdit,NotebookEdit');
  });
  it('scanning role denies all write tools', () => {
    assert.equal(buildDisallowedTools('scanning'), 'Write,Edit,MultiEdit,NotebookEdit');
  });
  it('undefined role falls back to empty (no restrictions)', () => {
    assert.equal(buildDisallowedTools(undefined), '');
  });
});

describe('ROLE_DISALLOWED_TOOLS', () => {
  it('is exported and covers all AgentRole variants', () => {
    const roles = ['analysis', 'coding', 'verification', 'testing', 'pr', 'scanning'] as const;
    for (const r of roles) {
      assert.ok(r in ROLE_DISALLOWED_TOOLS, `missing role ${r}`);
    }
  });
});
