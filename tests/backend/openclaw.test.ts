import { describe, it, expect, vi } from 'vitest';
import { OpenClawBackend } from '../../src/backend/openclaw.js';

describe('OpenClawBackend', () => {
  it('should create an instance', () => {
    const backend = new OpenClawBackend();
    expect(backend).toBeDefined();
  });

  it('should have required methods', () => {
    const backend = new OpenClawBackend();
    expect(typeof backend.install).toBe('function');
    expect(typeof backend.uninstall).toBe('function');
    expect(typeof backend.startRun).toBe('function');
    expect(typeof backend.stopRun).toBe('function');
  });
});
