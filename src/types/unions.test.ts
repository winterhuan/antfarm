import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  isStepPending, isStepRunning, isStepDone, isStepFailed,
  isOpenClawConfig, isHermesConfig, isClaudeCodeConfig, isCodexConfig
} from './unions.js';
import type { StepPending, StepRunning, StepDone, StepFailed, BackendConfig } from './unions.js';

describe('step result unions', () => {
  const pending: StepPending = { status: 'pending', retryCount: 0, createdAt: '2024-01-01' };
  const running: StepRunning = { status: 'running', claimedAt: '2024-01-01', claimedBy: 'agent-1' };
  const done: StepDone = { status: 'done', output: 'done', completedAt: '2024-01-01' };
  const failed: StepFailed = { status: 'failed', output: 'error', failedAt: '2024-01-01', retryCount: 0 };

  it('narrows pending correctly', () => {
    assert.strictEqual(isStepPending(pending), true);
    assert.strictEqual(isStepPending(running), false);
    assert.strictEqual(isStepPending(done), false);
    assert.strictEqual(isStepPending(failed), false);
  });

  it('narrows running correctly', () => {
    assert.strictEqual(isStepRunning(running), true);
    assert.strictEqual(isStepRunning(pending), false);
    assert.strictEqual(isStepRunning(done), false);
    assert.strictEqual(isStepRunning(failed), false);
  });

  it('narrows done correctly', () => {
    assert.strictEqual(isStepDone(done), true);
    assert.strictEqual(isStepDone(pending), false);
    assert.strictEqual(isStepDone(running), false);
    assert.strictEqual(isStepDone(failed), false);
  });

  it('narrows failed correctly', () => {
    assert.strictEqual(isStepFailed(failed), true);
    assert.strictEqual(isStepFailed(pending), false);
    assert.strictEqual(isStepFailed(running), false);
    assert.strictEqual(isStepFailed(done), false);
  });
});

describe('backend config unions', () => {
  const openclaw: BackendConfig = { type: 'openclaw', gatewayUrl: 'http://localhost', apiKey: 'key' };
  const hermes: BackendConfig = { type: 'hermes', hermesHome: '/home/user/.hermes' };
  const claudeCode: BackendConfig = { type: 'claude-code', projectDir: '/project' };
  const codex: BackendConfig = { type: 'codex', codexHome: '/home/user/.codex' };

  it('narrows openclaw correctly', () => {
    assert.strictEqual(isOpenClawConfig(openclaw), true);
    assert.strictEqual(isOpenClawConfig(hermes), false);
    assert.strictEqual(isOpenClawConfig(claudeCode), false);
    assert.strictEqual(isOpenClawConfig(codex), false);
  });

  it('narrows hermes correctly', () => {
    assert.strictEqual(isHermesConfig(hermes), true);
    assert.strictEqual(isHermesConfig(openclaw), false);
    assert.strictEqual(isHermesConfig(claudeCode), false);
    assert.strictEqual(isHermesConfig(codex), false);
  });

  it('narrows claude-code correctly', () => {
    assert.strictEqual(isClaudeCodeConfig(claudeCode), true);
    assert.strictEqual(isClaudeCodeConfig(openclaw), false);
    assert.strictEqual(isClaudeCodeConfig(hermes), false);
    assert.strictEqual(isClaudeCodeConfig(codex), false);
  });

  it('narrows codex correctly', () => {
    assert.strictEqual(isCodexConfig(codex), true);
    assert.strictEqual(isCodexConfig(openclaw), false);
    assert.strictEqual(isCodexConfig(hermes), false);
    assert.strictEqual(isCodexConfig(claudeCode), false);
  });
});
