import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HermesBackend, getProfileName } from '../../src/backend/hermes.js';
import type { WorkflowSpec } from '../../src/installer/types.js';

// Helper to check if a call matches expected file and args (ignores third arg)
function expectExecCall(mockFn: typeof mockExecFile, file: string, args: unknown[]) {
  const found = mockFn.mock.calls.find(
    (call: unknown[]) => call[0] === file && arraysEqual(call[1] as unknown[], args)
  );
  expect(found).toBeDefined();
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, i) => val === b[i]);
}

// Mock child_process - execFile uses callback pattern, promisify wraps it
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    // execFile signature: (file, args, options?, callback)
    const file = args[0] as string;
    const execArgs = args[1] as string[];
    const maybeOptions = args[2];
    const maybeCallback = args[3];
    const callback = (typeof maybeOptions === 'function' ? maybeOptions : maybeCallback) as (err: Error | null, result?: { stdout: string; stderr: string }) => void;
    const options = typeof maybeOptions === 'function' ? undefined : maybeOptions;

    // Track the call and get the mock result
    const result = mockExecFile(file, execArgs, options);

    // Call the callback asynchronously to match real behavior
    setTimeout(() => {
      if (!callback) return;
      // Handle both resolved and rejected promises from mock
      Promise.resolve(result).then(
        (res) => callback(null, res || { stdout: '', stderr: '' }),
        (err) => callback(err)
      );
    }, 0);
  },
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
    it('should generate correct profile name with underscore separator', () => {
      // New naming: underscore separator avoids namespace collisions
      // workflow=foo + agent=bar-baz => foo_bar-baz
      // workflow=foo-bar + agent=baz => foo-bar_baz
      expect(getProfileName('my-workflow', 'agent-1')).toBe('my-workflow_agent-1');
      expect(getProfileName('foo', 'bar-baz')).toBe('foo_bar-baz');
      expect(getProfileName('foo-bar', 'baz')).toBe('foo-bar_baz');
      // These are now distinct (unlike hyphen-only separation)
      expect(getProfileName('foo', 'bar-baz')).not.toBe(getProfileName('foo-bar', 'baz'));
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

      // Check that profile create was called (any position since we have multiple calls)
      const createCall = mockExecFile.mock.calls.find(
        (call: unknown[]) =>
          (call[1] as string[])?.[0] === 'profile' && (call[1] as string[])?.[1] === 'create'
      );
      expect(createCall).toBeDefined();
      expect(createCall![1]).toEqual(['profile', 'create', 'test-workflow_agent-1', '--clone', '--clone-from', 'default']);
    });

    it('should use hermes config set for configuration', async () => {
      await backend.install(mockWorkflow, '/source/dir');

      // Should set model (--profile before subcommand)
      expectExecCall(mockExecFile, 'hermes', ['--profile', 'test-workflow_agent-1', 'config', 'set', 'model.model', 'claude-3-sonnet']);

      // Should set timeout (--profile before subcommand)
      expectExecCall(mockExecFile, 'hermes', ['--profile', 'test-workflow_agent-1', 'config', 'set', 'timeout.seconds', '1800']);

      // Should set terminal backend and cwd (--profile before subcommand)
      expectExecCall(mockExecFile, 'hermes', ['--profile', 'test-workflow_agent-1', 'config', 'set', 'terminal.backend', 'local']);
      const cwdCall = mockExecFile.mock.calls.find(
        (call: unknown[]) =>
          (call[1] as string[])?.[0] === '--profile' &&
          (call[1] as string[])?.[4] === 'terminal.cwd'
      );
      expect(cwdCall).toBeDefined();
    });

    it('should use hermes cron add for cron setup', async () => {
      // Mock empty cron list for idempotency check
      mockExecFile.mockImplementation((cmd: string, args: string[]) => {
        if (args.includes('cron') && args.includes('list')) {
          return Promise.resolve({ stdout: 'No scheduled jobs.', stderr: '' });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      await backend.install(mockWorkflow, '/source/dir');

      // --profile goes before subcommand
      expectExecCall(mockExecFile, 'hermes', [
        '--profile', 'test-workflow_agent-1',
        'cron', 'add',
        '--name', 'antfarm/test-workflow/agent-1',
        '--every', '5m',
        '--prompt', 'test polling prompt',
      ]);
    });

    it('should copy agent workspace files', async () => {
      await backend.install(mockWorkflow, '/source/dir');

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('workspace'),
        { recursive: true }
      );
      expect(mockCopyFile).toHaveBeenCalledWith(
        '/source/dir/CLAUDE.md',
        expect.stringContaining('CLAUDE.md')
      );
    });

    it('should create .antfarm marker file with JSON content', async () => {
      await backend.install(mockWorkflow, '/source/dir');

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.antfarm'),
        expect.stringContaining('test-workflow'), // JSON string contains workflowId
        'utf-8'
      );

      // Verify it's valid JSON with expected structure
      const markerCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) => String(call[0]).includes('.antfarm')
      );
      expect(markerCall).toBeDefined();
      const markerContent = markerCall![1] as string;
      const marker = JSON.parse(markerContent);
      expect(marker.workflowId).toBe('test-workflow');
      expect(marker.version).toBe(1);
      expect(marker.createdAt).toBeDefined();
    });

    it('should throw error if profile already exists for different workflow', async () => {
      // Profile already present on disk (returned by fs.readdir)
      mockReaddir.mockResolvedValue([dirent('test-workflow_agent-1')])
;
      // Marker exists but belongs to another workflow
      mockReadFile.mockImplementation((path: string) => {
        if (String(path).includes('.antfarm')) {
          return Promise.resolve(JSON.stringify({ workflowId: 'different-workflow', version: 1, createdAt: '2024-01-01' }));
        }
        return Promise.resolve('');
      });

      await expect(backend.install(mockWorkflow, '/source/dir')).rejects.toThrow(
        'belongs to a different workflow'
      );
    });

    it('should reject when profile exists without marker (external profile, not ours)', async () => {
      // Profile dir exists on disk but marker file is missing — treat as external
      mockReaddir.mockResolvedValue([dirent('test-workflow_agent-1')])
;
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      await expect(backend.install(mockWorkflow, '/source/dir')).rejects.toThrow(
        'belongs to a different workflow'
      );
    });

    it('should skip creation and continue setup when profile is already owned by same workflow', async () => {
      mockReaddir.mockResolvedValue([dirent('test-workflow_agent-1')])
;
      mockReadFile.mockImplementation((path: string) => {
        if (String(path).includes('.antfarm')) {
          return Promise.resolve(JSON.stringify({ workflowId: 'test-workflow', version: 1, createdAt: '2024-01-01' }));
        }
        return Promise.resolve('');
      });

      await backend.install(mockWorkflow, '/source/dir');

      // Should NOT call `hermes profile create` — profile already owned
      const createCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) => (call[1] as string[])?.[0] === 'profile' && (call[1] as string[])?.[1] === 'create'
      );
      expect(createCalls).toHaveLength(0);

      // But should still configure + setup cron
      expectExecCall(mockExecFile, 'hermes', ['--profile', 'test-workflow_agent-1', 'config', 'set', 'model.model', 'claude-3-sonnet']);
    });

    it('should install workspace skills', async () => {
      const skillWorkflow: WorkflowSpec = {
        ...mockWorkflow,
        agents: [{
          ...mockWorkflow.agents[0],
          workspace: {
            baseDir: 'agent-1',
            files: { 'CLAUDE.md': './CLAUDE.md' },
            skills: ['agent-browser', 'web-search'],
          },
        }],
      };

      await backend.install(skillWorkflow, '/source/dir');

      // Should install skills
      expectExecCall(mockExecFile, 'hermes', ['--profile', 'test-workflow_agent-1', 'skills', 'install', 'agent-browser', '--yes']);
      expectExecCall(mockExecFile, 'hermes', ['--profile', 'test-workflow_agent-1', 'skills', 'install', 'web-search', '--yes']);
    });

    it('should skip cron add if cron already exists (idempotent)', async () => {
      // Mock cron list returning existing cron (text format)
      mockExecFile.mockImplementation((cmd: string, args: string[]) => {
        if (args.includes('cron') && args.includes('list')) {
          return Promise.resolve({ stdout: 'antfarm/test-workflow/agent-1 - every 5m', stderr: '' });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      await backend.install(mockWorkflow, '/source/dir');

      // Should NOT call cron add
      const cronAddCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) => (call[1] as string[])?.[2] === 'cron' && (call[1] as string[])?.[3] === 'add'
      );
      expect(cronAddCalls).toHaveLength(0);
    });

    it('should use ?? for timeout to preserve 0 as valid value', async () => {
      const zeroTimeoutWorkflow: WorkflowSpec = {
        ...mockWorkflow,
        agents: [{ ...mockWorkflow.agents[0], timeoutSeconds: 0 }],
      };

      await backend.install(zeroTimeoutWorkflow, '/source/dir');

      // Should set timeout to '0' not the default
      const timeoutCall = mockExecFile.mock.calls.find(
        (call: unknown[]) =>
          (call[1] as string[])?.[0] === '--profile' &&
          (call[1] as string[])?.[4] === 'timeout.seconds'
      );
      expect(timeoutCall).toBeDefined();
      expect((timeoutCall![1] as string[])[5]).toBe('0');
    });

    it('should use default model when not specified', async () => {
      const noModelWorkflow: WorkflowSpec = {
        ...mockWorkflow,
        agents: [{ ...mockWorkflow.agents[0], model: undefined }],
      };

      await backend.install(noModelWorkflow, '/source/dir');

      const modelCall = mockExecFile.mock.calls.find(
        (call: unknown[]) =>
          (call[1] as string[])?.[0] === '--profile' &&
          (call[1] as string[])?.[4] === 'model.model'
      );
      expect(modelCall).toBeDefined();
      expect((modelCall![1] as string[])[5]).toBe('default');
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

    it('should rollback on install failure', async () => {
      mockReaddir.mockResolvedValue([]);

      // First agent succeeds, second fails
      const multiAgentWorkflow: WorkflowSpec = {
        ...mockWorkflow,
        agents: [
          { ...mockWorkflow.agents[0], id: 'agent-1' },
          { ...mockWorkflow.agents[0], id: 'agent-2' },
        ],
      };

      let callCount = 0;
      mockExecFile.mockImplementation((cmd: string, args: string[]) => {
        callCount++;
        // Fail on the second agent's cron setup
        if (args.includes('cron') && args.includes('add') && args.includes('agent-2')) {
          return Promise.reject(new Error('Cron setup failed'));
        }
        if (args.includes('cron') && args.includes('list')) {
          return Promise.resolve({ stdout: '[]', stderr: '' });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      await expect(backend.install(multiAgentWorkflow, '/source/dir')).rejects.toThrow('Cron setup failed');

      // Should have tried to clean up agent-1 (stop gateway, delete profile)
      const stopCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) =>
          (call[1] as string[])?.[1] === 'test-workflow_agent-1' &&
          (call[1] as string[])?.[3] === 'stop'
      );
      expect(stopCalls.length).toBeGreaterThanOrEqual(1);

      const deleteCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) =>
          (call[1] as string[])?.[1] === 'test-workflow_agent-1' &&
          (call[1] as string[])?.[2] === 'profile' &&
          (call[1] as string[])?.[3] === 'delete'
      );
      expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('uninstall', () => {
    it('should stop gateway with hermes --profile gateway stop', async () => {
      mockReaddir.mockResolvedValue([dirent('test-workflow_agent-1')])
;
      mockReadFile.mockResolvedValue(JSON.stringify({ workflowId: 'test-workflow', version: 1 }));

      await backend.uninstall('test-workflow');

      // --profile goes before subcommand
      expectExecCall(mockExecFile, 'hermes', ['--profile', 'test-workflow_agent-1', 'gateway', 'stop']);
    });

    it('should delete profiles with hermes --profile profile delete', async () => {
      mockReaddir.mockResolvedValue([dirent('test-workflow_agent-1')])
;
      mockReadFile.mockResolvedValue(JSON.stringify({ workflowId: 'test-workflow', version: 1 }));

      await backend.uninstall('test-workflow');

      // --profile goes before subcommand
      expectExecCall(mockExecFile, 'hermes', ['--profile', 'test-workflow_agent-1', 'profile', 'delete', '--yes']);
    });

    it('should only list profiles with exact workflow prefix', async () => {
      // Profile dir contains both "test-workflow_*" and a differently-prefixed profile.
      // "test-workflow-2_agent-1" shares a prefix but belongs to a different workflow id.
      mockReaddir.mockResolvedValue([
        dirent('test-workflow_agent-1'),
        dirent('test-workflow-2_agent-1'),
        dirent('unrelated-profile'),
      ]);

      // Mock marker file checks - verifyProfileOwnership reads the marker
      mockReadFile.mockImplementation((path: string) => {
        if (String(path).includes('test-workflow-2_agent-1')) {
          return Promise.resolve(JSON.stringify({ workflowId: 'test-workflow-2', version: 1 }));
        }
        if (String(path).includes('test-workflow_agent-1')) {
          return Promise.resolve(JSON.stringify({ workflowId: 'test-workflow', version: 1 }));
        }
        return Promise.reject(new Error('ENOENT'));
      });

      await backend.uninstall('test-workflow');

      // Should only delete test-workflow_agent-1 (command: ['--profile', name, 'profile', 'delete', '--yes'])
      const deleteCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) => (call[1] as string[])?.[2] === 'profile' && (call[1] as string[])?.[3] === 'delete'
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0][1]).toContain('test-workflow_agent-1');
      // Guard against a regression where the prefix filter loosens
      expect(deleteCalls[0][1]).not.toContain('test-workflow-2_agent-1');
      expect(deleteCalls[0][1]).not.toContain('unrelated-profile');
    });

    it('should verify ownership before deletion and skip unowned profiles', async () => {
      mockReaddir.mockResolvedValue([dirent('test-workflow_agent-1'), dirent('test-workflow_agent-2')]);

      // agent-1 belongs to us, agent-2 belongs to another workflow
      mockReadFile.mockImplementation((path: string) => {
        if (String(path).includes('agent-2')) {
          return Promise.resolve(JSON.stringify({ workflowId: 'other-workflow', version: 1 }));
        }
        return Promise.resolve(JSON.stringify({ workflowId: 'test-workflow', version: 1 }));
      });

      await backend.uninstall('test-workflow');

      // Should only delete agent-1
      const deleteCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) => (call[1] as string[])?.[2] === 'profile' && (call[1] as string[])?.[3] === 'delete'
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0][1]).toContain('test-workflow_agent-1');
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
      expectExecCall(mockExecFile, 'hermes', ['--profile', 'test-workflow_agent-1', 'gateway', 'start']);
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

      // Should have tried to stop the first two (command: ['--profile', name, 'gateway', 'stop'])
      const stopCalls = mockExecFile.mock.calls.filter(
        (call: unknown[]) => call[0] === 'hermes' && (call[1] as string[])?.[2] === 'gateway' && (call[1] as string[])?.[3] === 'stop'
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
      expect((call as unknown[])[1]).toContain('test; rm -rf /; #_agent-1');
    });
  });

  describe('stopRun', () => {
    it('should stop gateway with hermes --profile gateway stop', async () => {
      await backend.stopRun(mockWorkflow);

      // --profile goes before subcommand
      expectExecCall(mockExecFile, 'hermes', ['--profile', 'test-workflow_agent-1', 'gateway', 'stop']);
    });

    it('should not fail if gateway is not running', async () => {
      // Mock gateway stop to fail (simulating not running)
      mockExecFile.mockRejectedValueOnce(new Error('gateway not running'));

      // Should not throw
      await expect(backend.stopRun(mockWorkflow)).resolves.not.toThrow();
    });

    it('should log warnings on stop failure', async () => {
      mockExecFile.mockRejectedValue(new Error('gateway not running'));

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await backend.stopRun(mockWorkflow);

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });
});
