import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import type { Backend } from './interface.js';
import type { WorkflowSpec, WorkflowAgent } from '../installer/types.js';
import { buildPollingPrompt } from '../installer/agent-cron.js';

const exec = promisify(execFile);

export function getProfileName(workflowId: string, agentId: string): string {
  return `${workflowId}-${agentId}`;
}

export class HermesBackend implements Backend {
  async install(workflow: WorkflowSpec, sourceDir: string): Promise<void> {
    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);

      // Create Hermes profile
      await this.createProfile(workflow.id, profileName);

      // Create workspace
      await this.createWorkspace(workflow.id, profileName, workflow, agent, sourceDir);

      // Configure profile
      await this.configureProfile(profileName, agent);

      // Setup cron
      await this.setupCron(profileName, workflow.id, agent.id);
    }
  }

  async uninstall(workflowId: string): Promise<void> {
    // Hermes profiles are self-contained (workspace, config, cron all within profile).
    // Unlike OpenClaw, no external coordination needed - delete profiles directly.
    const profiles = await this.listWorkflowProfiles(workflowId);

    for (const profileName of profiles) {
      try {
        // Stop gateway if running (using array args, no shell injection)
        await exec('hermes', ['--profile', profileName, 'gateway', 'stop']).catch(() => {});

        // Delete profile
        await exec('hermes', ['--profile', profileName, 'profile', 'delete', '--yes']);
      } catch {
        // Profile may not exist, ignore errors
      }
    }
  }

  async startRun(workflow: WorkflowSpec): Promise<void> {
    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);
      // Use array args to prevent shell injection; --profile goes before subcommand
      await exec('hermes', ['--profile', profileName, 'gateway', 'start']);
    }
  }

  async stopRun(workflow: WorkflowSpec): Promise<void> {
    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);
      // Use array args to prevent shell injection; --profile goes before subcommand
      await exec('hermes', ['--profile', profileName, 'gateway', 'stop']).catch(() => {});
    }
  }

  private async createProfile(workflowId: string, profileName: string): Promise<void> {
    // Check if profile already exists before creating
    const existingProfiles = await this.listAllProfiles();
    if (existingProfiles.includes(profileName)) {
      // Profile exists - verify it belongs to this workflow by checking its antfarm metadata
      const isOwned = await this.verifyProfileOwnership(workflowId, profileName);
      if (!isOwned) {
        throw new Error(
          `Profile "${profileName}" already exists but belongs to a different workflow. ` +
          `Please choose a different workflow ID or manually remove the conflicting profile.`
        );
      }
      // Profile exists and belongs to us - skip creation but continue with workspace/config setup
      return;
    }

    // Profile doesn't exist - create it
    await exec('hermes', ['profile', 'create', profileName, '--clone', '--clone-from', 'default']);
  }

  private async listAllProfiles(): Promise<string[]> {
    try {
      const { stdout } = await exec('hermes', ['profile', 'list']);
      return stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => line.split(/\s+/)[0]);
    } catch {
      return [];
    }
  }

  private async verifyProfileOwnership(workflowId: string, profileName: string): Promise<boolean> {
    try {
      // Check if profile name follows our naming convention: {workflowId}-{agentId}
      const expectedPrefix = `${workflowId}-`;
      if (!profileName.startsWith(expectedPrefix)) {
        return false;
      }

      // Verify by checking if the profile's workspace exists and has our marker
      const profileDir = path.join(os.homedir(), '.hermes', 'profiles', profileName);
      const antfarmMarker = path.join(profileDir, 'workspace', '.antfarm');

      try {
        await fs.access(antfarmMarker);
        const markerContent = await fs.readFile(antfarmMarker, 'utf-8');
        return markerContent.trim() === workflowId;
      } catch {
        // Marker doesn't exist or can't be read - assume not owned
        return false;
      }
    } catch {
      return false;
    }
  }

  private async createWorkspace(
    workflowId: string,
    profileName: string,
    workflow: WorkflowSpec,
    agent: WorkflowAgent,
    sourceDir: string
  ): Promise<void> {
    const profileDir = path.join(os.homedir(), '.hermes', 'profiles', profileName);
    const workspaceDir = path.join(profileDir, 'workspace');

    await fs.mkdir(workspaceDir, { recursive: true });

    // Create antfarm ownership marker file
    const markerPath = path.join(workspaceDir, '.antfarm');
    await fs.writeFile(markerPath, workflowId, 'utf-8');

    // Copy agent workspace files
    for (const [fileName, relativePath] of Object.entries(agent.workspace.files)) {
      const srcPath = path.resolve(sourceDir, relativePath);
      const dstPath = path.join(workspaceDir, fileName);
      await fs.copyFile(srcPath, dstPath);
    }
  }

  private async configureProfile(profileName: string, agent: WorkflowAgent): Promise<void> {
    // Use hermes CLI to set config values (preserves cloned settings)
    // --profile goes before the subcommand
    const model = agent.model || 'anthropic/claude-sonnet-4';
    await exec('hermes', ['--profile', profileName, 'config', 'set', 'model.model', model]);

    // Set timeout
    const timeoutSeconds = String(agent.timeoutSeconds || 1800);
    await exec('hermes', ['--profile', profileName, 'config', 'set', 'timeout.seconds', timeoutSeconds]);

    // Set workspace path using the actual profile workspace directory
    const profileDir = path.join(os.homedir(), '.hermes', 'profiles', profileName);
    const workspaceDir = path.join(profileDir, 'workspace');
    await exec('hermes', ['--profile', profileName, 'config', 'set', 'terminal.cwd', workspaceDir]);
    await exec('hermes', ['--profile', profileName, 'config', 'set', 'terminal.backend', 'local']);
  }

  private async setupCron(profileName: string, workflowId: string, agentId: string): Promise<void> {
    const prompt = buildPollingPrompt(workflowId, agentId);
    const cronName = `antfarm/${workflowId}/${agentId}`;

    // Use hermes cron add CLI instead of writing files directly
    // --profile goes before the subcommand
    await exec('hermes', [
      '--profile', profileName,
      'cron', 'add',
      '--name', cronName,
      '--every', '5m',
      '--prompt', prompt,
    ]);
  }

  private async listWorkflowProfiles(workflowId: string): Promise<string[]> {
    try {
      const { stdout } = await exec('hermes', ['profile', 'list']);
      const prefix = `${workflowId}-`;

      return stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => line.split(/\s+/)[0])
        .filter(profileName => {
          // Exact prefix match: profile must start with "{workflowId}-" followed by agent ID
          // This prevents "foo" matching "foo-bar" - only "foo-{agentId}" should match
          if (!profileName.startsWith(prefix)) {
            return false;
          }
          const suffix = profileName.slice(prefix.length);
          // Suffix must be non-empty (the agent ID)
          return suffix.length > 0;
        });
    } catch {
      return [];
    }
  }
}
