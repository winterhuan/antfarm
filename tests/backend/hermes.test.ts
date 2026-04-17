import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HermesBackend, createCronJob, getProfileName } from '../../src/backend/hermes.js';
import type { WorkflowSpec, WorkflowAgent } from '../../src/installer/types.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn(),
    copyFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

describe('HermesBackend', () => {
  let backend: HermesBackend;

  beforeEach(() => {
    backend = new HermesBackend();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getProfileName', () => {
    it('should generate correct profile name', () => {
      expect(getProfileName('my-workflow', 'agent-1')).toBe('my-workflow-agent-1');
    });
  });

  describe('createCronJob', () => {
    it('should create a cron job with correct structure', () => {
      const job = createCronJob('wf', 'agent1', 'test prompt');
      expect(job.id).toBe('antfarm-wf-agent1');
      expect(job.name).toBe('antfarm/wf/agent1');
      expect(job.schedule.kind).toBe('every');
      expect(job.schedule.everyMs).toBe(300000);
      expect(job.prompt).toBe('test prompt');
      expect(job.enabled).toBe(true);
    });
  });

  describe('Backend interface', () => {
    it('should have required methods', () => {
      expect(typeof backend.install).toBe('function');
      expect(typeof backend.uninstall).toBe('function');
      expect(typeof backend.startRun).toBe('function');
      expect(typeof backend.stopRun).toBe('function');
    });
  });
});
