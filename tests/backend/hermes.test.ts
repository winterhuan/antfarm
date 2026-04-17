import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HermesBackend, getProfileName } from '../../src/backend/hermes.js';
import type { WorkflowSpec } from '../../src/installer/types.js';

// Mock child_process
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Mock fs/promises — include readdir because listAllProfiles/listWorkflowProfiles
// now scan ~/.hermes/profiles directly instead of parsing `hermes profile list` stdout.
const mockMkdir = vi.fn();
const mockCopyFile = vi.fn();
const mockWriteFile = vi.fn();
const mockAccess = vi.fn();
const mockReadFile = vi.fn();
const mockReaddir = vi.fn();

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    copyFile: (...args: unknown[]) => mockCopyFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    access: (...args: unknown[]) => mockAccess(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    readdir: (...args: unknown[]) => mockReaddir(...args),
  },
}));

// Mock agent-cron
vi.mock('../../src/installer/agent-cron.js', () => ({
  buildPollingPrompt: vi.fn(() => 'test polling prompt'),
}));

// Helper to build readdir return shape (Dirent-like objects)
function dirent(name: string, isDir = true) {
  return { name, isDirectory: () => isDir };
}

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
          baseDir: 'agent-1',
          files: { 'CLAUDE.md': './CLAUDE.md' },
        },
      },
    ],
    steps: [{ id: 'step-1', agent: 'agent-1', input: 'test', expects: 'result' }],
    version: 1,
  };

  beforeEach(() => {
    backend = new HermesBackend();
    vi.clearAllMocks();
    // Default successful responses
    mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
    // Default: no profiles on disk — individual tests override with mockResolvedValueOnce
    mockReaddir.mockResolvedValue([]);
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
      // Profile already present on disk (returned by fs.readdir)
      mockReaddir.mockResolvedValue([dirent('test-workflow-agent-1')]);
      // Marker exists but belongs to another workflow
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('different-workflow');

      await expect(backend.install(mockWorkflow, '/source/dir')).rejects.toThrow(
        'belongs to a different workflow'
      );
    });

    it('should reject when profile exists without marker (external profile, not ours)', async () => {
      // Profile dir exists on disk but marker file is missing — treat as external
      mockReaddir.mockResolvedValue([dirent('test-workflow-agent-1')]);
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      await expect(backend.install(mockWorkflow, '/source/dir')).rejects.toThrow(
        'belongs to a different workflow'
      );
    });

    it('should skip creation and continue setup when profile is already owned by same workflow', async () => {
      mockReaddir.mockResolvedValue([dirent('test-workflow-agent-1')]);
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('test-workflow');

      await backend.install(mockWorkflow, '/source/dir');

      // Should NOT call `hermes profile create` — profile already owned
      const createCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) => (call[1] as string[])?.[0] === 'profile' && (call[1] as string[])?.[1] === 'create'
      );
      expect(createCalls).toHaveLength(0);

      // But should still configure + setup cron
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['--profile', 'test-workflow-agent-1', 'config', 'set', 'model.model', 'claude-3-sonnet'],
        expect.any(Object)
      );
    });
  });

  describe('partial install recovery', () => {
    it('should write marker immediately after profile creation, before workspace files', async () => {
      // No existing profile
      mockReaddir.mockResolvedValue([]);

      await backend.install(mockWorkflow, '/source/dir');

      // Verify call ordering: profile create → marker write → file copy
      const createIdx = mockExecFile.mock.invocationCallOrder[
        mockExecFile.mock.calls.findIndex(
          (c: unknown[]) => (c[1] as string[])?.[0] === 'profile' && (c[1] as string[])?.[1] === 'create'
        )
      ];
      const markerIdx = mockWriteFile.mock.invocationCallOrder[
        mockWriteFile.mock.calls.findIndex((c: unknown[]) => String(c[0]).includes('.antfarm'))
      ];
      const copyIdx = mockCopyFile.mock.invocationCallOrder[0];

      expect(createIdx).toBeDefined();
      expect(markerIdx).toBeDefined();
      expect(copyIdx).toBeDefined();
      expect(markerIdx).toBeGreaterThan(createIdx);
      expect(markerIdx).toBeLessThan(copyIdx);
    });
  });

  describe('uninstall', () => {
    it('should stop gateway with hermes --profile gateway stop', async () => {
      mockReaddir.mockResolvedValue([dirent('test-workflow-agent-1')]);

      await backend.uninstall('test-workflow');

      // --profile goes before subcommand
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['--profile', 'test-workflow-agent-1', 'gateway', 'stop'],
        expect.any(Object)
      );
    });

    it('should delete profiles with hermes --profile profile delete', async () => {
      mockReaddir.mockResolvedValue([dirent('test-workflow-agent-1')]);

      await backend.uninstall('test-workflow');

      // --profile goes before subcommand
      expect(mockExecFile).toHaveBeenCalledWith(
        'hermes',
        ['--profile', 'test-workflow-agent-1', 'profile', 'delete', '--yes'],
        expect.any(Object)
      );
    });

    it('should only list profiles with exact workflow prefix', async () => {
      // Profile dir contains both "test-workflow-*" and a differently-prefixed profile.
      // "test-workflow-2-agent-1" shares a prefix but belongs to a different workflow id.
      mockReaddir.mockResolvedValue([
        dirent('test-workflow-agent-1'),
        dirent('test-workflow-2-agent-1'),
        dirent('unrelated-profile'),
      ]);

      await backend.uninstall('test-workflow');

      // Should only delete test-workflow-agent-1
      const deleteCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) => (call[1] as string[])?.[2] === 'profile' && (call[1] as string[])?.[3] === 'delete'
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0][1]).toContain('test-workflow-agent-1');
      // Guard against a regression where the prefix filter loosens
      expect(deleteCalls[0][1]).not.toContain('test-workflow-2-agent-1');
      expect(deleteCalls[0][1]).not.toContain('unrelated-profile');
    });

    it('should not fail when hermes profiles dir does not exist', async () => {
      mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      await expect(backend.uninstall('test-workflow')).resolves.not.toThrow();
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
        (call: unknown[]) => call[0] === 'hermes' && (call[1] as string[])?.[2] === 'stop'
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
        (c: unknown[]) => c[0] === 'hermes' && (c[1] as string[])?.[2] === 'gateway'
      );
      expect(call).toBeDefined();
      // Profile name should contain the literal string, not be split by shell
      expect((call as unknown[])[1]).toContain('test; rm -rf /; #-agent-1');
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
