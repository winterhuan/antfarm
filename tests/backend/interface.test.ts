import { describe, it, expect } from 'vitest';
import { createBackend, type Backend } from '../../src/backend/index.js';

describe('Backend Interface', () => {
  it('should export Backend interface types', () => {
    // This is a compile-time check
    const mockBackend: Backend = {
      install: async () => {},
      uninstall: async () => {},
      startRun: async () => {},
      stopRun: async () => {},
    };
    expect(mockBackend).toBeDefined();
  });

  it('should create OpenClaw backend', () => {
    const backend = createBackend('openclaw');
    expect(backend).toBeDefined();
    expect(typeof backend.install).toBe('function');
  });

  it('should create Hermes backend', () => {
    const backend = createBackend('hermes');
    expect(backend).toBeDefined();
    expect(typeof backend.install).toBe('function');
  });
});
