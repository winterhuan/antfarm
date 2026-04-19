import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexExecArgv } from './codex-spawn.js';

describe('buildCodexExecArgv', () => {
  it('composes canonical argv with profile + --cd + prompt', () => {
    const argv = buildCodexExecArgv({
      profileName: 'antfarm-demo-verifier',
      workspaceDir: '/tmp/workspace',
      prompt: 'do the thing',
      lastMessagePath: '/tmp/last-msg.txt',
    });
    assert.equal(argv[0], 'exec');
    assert.ok(argv.includes('--json'));
    assert.ok(argv.includes('--ephemeral'));
    assert.ok(argv.includes('--skip-git-repo-check'));
    assert.equal(argv[argv.indexOf('--cd') + 1], '/tmp/workspace');
    assert.equal(argv[argv.indexOf('--profile') + 1], 'antfarm-demo-verifier');
    assert.equal(argv[argv.indexOf('--output-last-message') + 1], '/tmp/last-msg.txt');
    const dashIdx = argv.indexOf('--');
    assert.ok(dashIdx > 0);
    assert.equal(argv[dashIdx + 1], 'do the thing');
    assert.equal(argv[argv.length - 1], 'do the thing');
  });

  it('supports additional writable directories via --add-dir', () => {
    const argv = buildCodexExecArgv({
      profileName: 'antfarm-demo-coder',
      workspaceDir: '/tmp/workspace',
      prompt: 'p',
      lastMessagePath: '/tmp/out.txt',
      addDirs: ['/tmp/extra-a', '/tmp/extra-b'],
    });
    const occurrences = argv.filter((v) => v === '--add-dir').length;
    assert.equal(occurrences, 2);
    assert.ok(argv.includes('/tmp/extra-a'));
    assert.ok(argv.includes('/tmp/extra-b'));
  });

  it('throws when prompt is empty', () => {
    assert.throws(() => buildCodexExecArgv({
      profileName: 'p', workspaceDir: '/tmp', prompt: '', lastMessagePath: '/tmp/x',
    }), /prompt/i);
  });

  it('throws when profileName is empty', () => {
    assert.throws(() => buildCodexExecArgv({
      profileName: '', workspaceDir: '/tmp', prompt: 'p', lastMessagePath: '/tmp/x',
    }), /profile/i);
  });
});
