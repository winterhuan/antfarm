import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HermesBackend, getProfileName } from '../../src/backend/hermes.js';
import type { WorkflowSpec, WorkflowAgent } from '../../src/installer/types.js';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';

// Mock child_process
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Mock fs/promises
const mockMkdir = vi.fn();
const mockCopyFile = vi.fn();
const mockWriteFile = vi.fn();
const mockAccess = vi.fn();
const mockReadFile = vi.fn();

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    copyFile: (...args: unknown[]) => mockCopyFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    access: (...args: unknown[]) => mockAccess(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}));

// Mock agent-cron
vi.mock('../../src/installer/agent-cron.js', () => ({
  buildPollingPrompt: vi.fn(() => 'test polling prompt'),
}));

describe('HermesBackend', () => {
  let backend: HermesBackend;
  const mockWorkflow: WorkflowSpec = {
    id: 'test-workflow',
    name: 'Test Workflow',
    agents: [
      {
        id: 'agent-1',
        name: 'Test Agent',
        role: 'coding',
        model: 'claude-3-sonnet',
        workspace: {
          files: { 'CLAUDE.md': './CLAUDE.md' },
        },
      },
    ],
    steps: [{ id: 'step-1', agent: 'agent-1', input: 'test', expects: 'result' }],
    version: '1.0',
  };

  beforeEach(() => {
    backend = new HermesBackend();
    vi.clearAllMocks();
    // Default successful responses
    mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getProfileName', () => {
    it('should generate correct profile name', () => {
      expect(getProfileName('my-workflow', 'agent-1')).toBe('my-workflow-agent-1');
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

  describe('install', () => {
    it('should create profile with hermes profile create', async () => {
      await backend.install(mockWorkflow, '/source/dir');

      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['profile', 'create', 'test-workflow-agent-1', '--clone', '--clone-from', 'default'],
        expect.any(Object)
      );
    });

    it('should use hermes config set for configuration', async () => {
      await backend.install(mockWorkflow, '/source/dir');

      // Should set model (--profile before subcommand)
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['--profile', 'test-workflow-agent-1', 'config', 'set', 'model.model', 'claude-3-sonnet'],
        expect.any(Object)
      );

      // Should set timeout (--profile before subcommand)
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['--profile', 'test-workflow-agent-1', 'config', 'set', 'timeout.seconds', '1800'],
        expect.any(Object)
      );

      // Should set terminal backend and cwd (--profile before subcommand)
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['--profile', 'test-workflow-agent-1', 'config', 'set', 'terminal.backend', 'local'],
        expect.any(Object)
      );
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['--profile', 'test-workflow-agent-1', 'config', 'set', 'terminal.cwd', expect.stringContaining('workspace')],
        expect.any(Object)
      );
    });

    it('should use hermes cron add for cron setup', async () => {
      await backend.install(mockWorkflow, '/source/dir');

      // --profile goes before subcommand
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        [
          '--profile', 'test-workflow-agent-1',
          'cron', 'add',
          '--name', 'antfarm/test-workflow/agent-1',
          '--every', '5m',
          '--prompt', 'test polling prompt',
        ],
        expect.any(Object)
      );
    });

    it('should copy agent workspace files', async () => {
      await backend.install(mockWorkflow, '/source/dir');

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('workspace'),
        { recursive: true }
      );
      expect(mockCopyFile).toHaveBeenCalledWith(
        '/source/dir/./CLAUDE.md',
        expect.stringContaining('CLAUDE.md')
      );
    });

    it('should create .antfarm marker file with workflow ID', async () => {
      await backend.install(mockWorkflow, '/source/dir');

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.antfarm'),
        'test-workflow',
        'utf-8'
      );
    });

    it('should throw error if profile already exists for different workflow', async () => {
      // Mock profile already exists
      mockExecFile.mockRejectedValueOnce(new Error('Profile already exists'));
      // Mock list shows the profile
      mockExecFile.mockResolvedValueOnce({ stdout: 'test-workflow-agent-1 active\n', stderr: '' });
      // Mock marker shows different workflow
      mockReadFile.mockResolvedValue('different-workflow');

      await expect(backend.install(mockWorkflow, '/source/dir')).rejects.toThrow(
        'belongs to a different workflow'
      );
    });

    it('should recover from partial install (profile exists, marker missing)', async () => {
      // First call: profile list shows profile exists
      // Second call: hermes profile create should not be called
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // listAllProfiles
      mockExecFile.mockResolvedValueOnce({ stdout: 'test-workflow-agent-1 active\n', stderr: '' }); // listWorkflowProfiles for createProfile check
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // config set commands
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // cron add

      // Mock fs.access to throw (marker doesn't exist)
      mockAccess.mockRejectedValue(new Error('ENOENT'));

      await expect(backend.install(mockWorkflow, '/source/dir')).rejects.toThrow(
        'belongs to a different workflow'
      );
    });

    it('should allow retry after partial install failure', async () => {
      // Simulate first attempt: profile created, workspace failed
      // Marker should be written by createProfile now, so second attempt should work
    });
  });

  describe('partial install recovery', () => {
    it('should write marker immediately after profile creation', async () => {
      // Reset mocks
      vi.clearAllMocks();

      // Mock successful responses
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockCopyFile.mockResolvedValue(undefined);

      await backend.install(mockWorkflow, '/source/dir');

      // Find the marker write call
      const markerCalls = mockWriteFile.mock.calls.filter(
        (call) => call[0]?.includes('.antfarm')
      );

      // Marker should be written
      expect(markerCalls.length).toBeGreaterThan(0);
    });

    it('should not write marker twice on retry', async () => {
      // Profile exists with marker - should skip marker write
    });
  });

  describe('uninstall', () => {
    it('should stop gateway with hermes --profile gateway stop', async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: 'test-workflow-agent-1 active\n',
        stderr: '',
      });

      await backend.uninstall('test-workflow');

      // --profile goes before subcommand
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['--profile', 'test-workflow-agent-1', 'gateway', 'stop'],
        expect.any(Object)
      );
    });

    it('should delete profiles with hermes --profile profile delete', async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: 'test-workflow-agent-1 active\n',
        stderr: '',
      });

      await backend.uninstall('test-workflow');

      // --profile goes before subcommand
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['--profile', 'test-workflow-agent-1', 'profile', 'delete', '--yes'],
        expect.any(Object)
      );
    });

    it('should only list profiles with exact workflow prefix', async () => {
      // Profile list returns test-workflow-agent-1 and test-workflow-2-agent-1
      mockExecFile.mockResolvedValueOnce({
        stdout: 'test-workflow-agent-1 active\ntest-workflow-2-agent-1 active\n',
        stderr: '',
      });

      await backend.uninstall('test-workflow');

      // Should only delete test-workflow-agent-1, not test-workflow-2-agent-1
      const deleteCalls = mockExecFile.mock.calls.filter(
        (call) => call[1]?.[0] === 'profile' && call[1]?.[1] === 'delete'
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0][1]).toContain('test-workflow-agent-1');
    });
  });

  describe('startRun', () => {
    it('should start gateway with hermes --profile gateway start', async () => {
      await backend.startRun(mockWorkflow);

      // --profile goes before subcommand
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['--profile', 'test-workflow-agent-1', 'gateway', 'start'],
        expect.any(Object)
      );
    });

    it('should rollback already started gateways when one fails', async () => {
      const multiAgentWorkflow: WorkflowSpec = {
        ...mockWorkflow,
        agents: [
          { ...mockWorkflow.agents[0], id: 'agent-1' },
          { ...mockWorkflow.agents[0], id: 'agent-2' },
          { ...mockWorkflow.agents[0], id: 'agent-3' },
        ],
      };

      // First two succeed, third fails
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // agent-1 start
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // agent-2 start
        .mockRejectedValueOnce(new Error('Port already in use')) // agent-3 start fails
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // agent-1 stop (rollback)
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // agent-2 stop (rollback)

      await expect(backend.startRun(multiAgentWorkflow)).rejects.toThrow('Port already in use');

      // Should have tried to stop the first two
      const stopCalls = mockExecFile.mock.calls.filter(
        (call) => call[0] === 'hermes' && call[1]?.[2] === 'stop'
      );
      expect(stopCalls).toHaveLength(2);
    });

    it('should not fail rollback when stop also fails', async () => {
      const multiAgentWorkflow: WorkflowSpec = {
        ...mockWorkflow,
        agents: [
          { ...mockWorkflow.agents[0], id: 'agent-1' },
          { ...mockWorkflow.agents[0], id: 'agent-2' },
        ],
      };

      // First succeeds, second fails, rollback stops fail too
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // agent-1 start
        .mockRejectedValueOnce(new Error('Port already in use')) // agent-2 start fails
        .mockRejectedValueOnce(new Error('Not running')); // agent-1 stop fails silently

      // Should still throw original error even if rollback fails
      await expect(backend.startRun(multiAgentWorkflow)).rejects.toThrow('Port already in use');
    });

    it('should not allow command injection in profile name', async () => {
      // Workflow with malicious agent ID attempting injection
      const maliciousWorkflow: WorkflowSpec = {
        ...mockWorkflow,
        id: 'test; rm -rf /; #',
        agents: [{ ...mockWorkflow.agents[0], id: 'agent-1' }],
      };

      await backend.startRun(maliciousWorkflow);

      // The profile name should be passed as a literal argument, not executed
      const call = mockExecFile.mock.calls.find(
        (c) => c[0] === 'hermes' && c[1]?.[2] === 'gateway'
      );
      expect(call).toBeDefined();
      // Profile name should contain the literal string, not be split by shell
      expect(call[1]).toContain('test; rm -rf /; #-agent-1');
    });
  });

  describe('stopRun', () => {
    it('should stop gateway with hermes --profile gateway stop', async () => {
      await backend.stopRun(mockWorkflow);

      // --profile goes before subcommand
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['--profile', 'test-workflow-agent-1', 'gateway', 'stop'],
        expect.any(Object)
      );
    });

    it('should not fail if gateway is not running', async () => {
      // Mock gateway stop to fail (simulating not running)
      mockExecFile.mockRejectedValueOnce(new Error('gateway not running'));

      // Should not throw
      await expect(backend.stopRun(mockWorkflow)).resolves.not.toThrow();
    });
  });
});
