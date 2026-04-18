import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeCodeArgv } from './claude-code-spawn.js';

describe('buildClaudeCodeArgv', () => {
  it('composes canonical argv for a verification agent', () => {
    const argv = buildClaudeCodeArgv({
      role: 'verification',
      prompt: 'do the thing',
      worktreeName: 'demo-wf_verifier',
      sessionId: '11111111-1111-1111-1111-111111111111',
      maxBudgetUsd: 0.5,
      model: 'sonnet',
    });
    // Must include these
    assert.equal(argv[0], '-p');
    assert.ok(argv.includes('--bare'));
    assert.ok(argv.includes('--no-session-persistence'));
    assert.ok(argv.includes('--output-format'));
    assert.equal(argv[argv.indexOf('--output-format') + 1], 'stream-json');
    assert.ok(argv.includes('--verbose'));
    assert.ok(argv.includes('--permission-mode'));
    assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'bypassPermissions');
    assert.equal(argv[argv.indexOf('--disallowedTools') + 1], 'Write,Edit,MultiEdit,NotebookEdit');
    assert.equal(argv[argv.indexOf('--worktree') + 1], 'demo-wf_verifier');
    assert.equal(argv[argv.indexOf('--session-id') + 1], '11111111-1111-1111-1111-111111111111');
    assert.equal(argv[argv.indexOf('--max-budget-usd') + 1], '0.5');
    assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet');
    // `--` separator before prompt, prompt last
    const dashIdx = argv.indexOf('--');
    assert.ok(dashIdx > 0);
    assert.equal(argv[dashIdx + 1], 'do the thing');
    assert.equal(argv[argv.length - 1], 'do the thing');
  });

  it('omits --disallowedTools for coding role (empty deny list)', () => {
    const argv = buildClaudeCodeArgv({
      role: 'coding',
      prompt: 'p',
      worktreeName: 'w',
      sessionId: '11111111-1111-1111-1111-111111111111',
      maxBudgetUsd: 1,
      model: 'sonnet',
    });
    assert.equal(argv.indexOf('--disallowedTools'), -1);
  });

  it('throws when prompt is empty', () => {
    assert.throws(() => buildClaudeCodeArgv({
      role: 'coding', prompt: '', worktreeName: 'w',
      sessionId: '11111111-1111-1111-1111-111111111111',
      maxBudgetUsd: 1, model: 'sonnet',
    }), /prompt/i);
  });
});
