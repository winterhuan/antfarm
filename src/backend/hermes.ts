import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import type { Backend } from './interface.js';
import type { WorkflowSpec, WorkflowAgent } from '../installer/types.js';
import { buildPollingPrompt } from '../installer/agent-cron.js';

const exec = promisify(execFile);

/**
 * Get profile name using underscore separator to avoid namespace collisions.
 * workflow=foo + agent=bar-baz => foo_bar-baz
 * workflow=foo-bar + agent=baz => foo-bar_baz
 * These are distinct unlike hyphen-only separation.
 */
export function getProfileName(workflowId: string, agentId: string): string {
  return `${workflowId}_${agentId}`;
}

interface AntfarmMarker {
  workflowId: string;
  version: number;
  createdAt: string;
}

export class HermesBackend implements Backend {
  private async getHermesProfilesDir(): Promise<string> {
    // Try to get Hermes home from environment variable or use default
    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
    return path.join(hermesHome, 'profiles');
  }

  async install(workflow: WorkflowSpec, sourceDir: string): Promise<void> {
    const installed: Array<{ profileName: string; hasCron: boolean }> = [];

    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);

      try {
        // Create Hermes profile
        await this.createProfile(workflow.id, profileName);

        // Create workspace
        await this.createWorkspace(workflow.id, profileName, workflow, agent, sourceDir);

        // Configure profile (including role-based permissions)
        await this.configureProfile(profileName, agent);

        // Setup cron (idempotent)
        const hasCron = await this.setupCron(profileName, workflow.id, agent.id);

        installed.push({ profileName, hasCron });
      } catch (err) {
        // Rollback: clean up what we've installed so far for this workflow
        await this.rollbackInstall(workflow.id, installed);
        throw err;
      }
    }
  }

  private async rollbackInstall(
    workflowId: string,
    installed: Array<{ profileName: string; hasCron: boolean }>
  ): Promise<void> {
    for (const { profileName, hasCron } of installed) {
      try {
        // Remove cron if added
        if (hasCron) {
          const cronName = `antfarm/${workflowId}/${profileName.split('_').pop()}`;
          await exec('hermes', ['--profile', profileName, 'cron', 'remove', '--name', cronName]).catch(() => {});
        }

        // Stop gateway if running
        await exec('hermes', ['--profile', profileName, 'gateway', 'stop']).catch(() => {});

        // Delete profile
        await exec('hermes', ['--profile', profileName, 'profile', 'delete', '--yes']).catch(() => {});
      } catch {
        // Best effort rollback, ignore errors
      }
    }
  }

  async uninstall(workflowId: string): Promise<void> {
    // Find profiles that belong to this workflow (verified via marker)
    const profiles = await this.listWorkflowProfiles(workflowId);

    for (const profileName of profiles) {
      try {
        // Double-check ownership before deletion (defense in depth)
        const isOwned = await this.verifyProfileOwnership(workflowId, profileName);
        if (!isOwned) {
          console.warn(`Skipping profile "${profileName}" - ownership verification failed`);
          continue;
        }

        // Stop gateway if running
        await exec('hermes', ['--profile', profileName, 'gateway', 'stop']).catch((err) => {
          console.warn(`Failed to stop gateway for ${profileName}: ${err}`);
        });

        // Delete profile
        await exec('hermes', ['--profile', profileName, 'profile', 'delete', '--yes']);
      } catch (err) {
        console.warn(`Failed to uninstall profile "${profileName}": ${err}`);
      }
    }
  }

  async startRun(workflow: WorkflowSpec): Promise<void> {
    const started: string[] = [];
    try {
      for (const agent of workflow.agents) {
        const profileName = getProfileName(workflow.id, agent.id);
        await exec('hermes', ['--profile', profileName, 'gateway', 'start']);
        started.push(profileName);
      }
    } catch (err) {
      for (const profileName of started) {
        await exec('hermes', ['--profile', profileName, 'gateway', 'stop']).catch(() => {});
      }
      throw err;
    }
  }

  async stopRun(workflow: WorkflowSpec): Promise<void> {
    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);
      try {
        await exec('hermes', ['--profile', profileName, 'gateway', 'stop']);
      } catch (err) {
        console.warn(`Failed to stop gateway for ${profileName}: ${err}`);
      }
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

    // Write marker immediately to mark profile as antfarm-owned before any further work
    const profilesDir = await this.getHermesProfilesDir();
    const profileDir = path.join(profilesDir, profileName);
    const marker: AntfarmMarker = {
      workflowId,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(profileDir, '.antfarm'), JSON.stringify(marker), 'utf-8');
  }

  private async scanProfiles(filter: (name: string) => boolean): Promise<string[]> {
    const profilesDir = await this.getHermesProfilesDir();
    try {
      const entries = await fs.readdir(profilesDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && filter(entry.name))
        .map((entry) => entry.name);
    } catch {
      // Directory doesn't exist or can't be read
      return [];
    }
  }

  private async listAllProfiles(): Promise<string[]> {
    return this.scanProfiles(() => true);
  }

  private async listWorkflowProfiles(workflowId: string): Promise<string[]> {
    // Use underscore prefix for new naming scheme
    const prefix = `${workflowId}_`;
    // Find profiles that start with the workflow prefix and verify ownership via marker file
    const candidates = await this.scanProfiles((name) => name.startsWith(prefix) && name.length > prefix.length);
    // Verify ownership to filter out profiles from other workflows
    const ownershipChecks = candidates.map(async (profileName) => {
      const isOwned = await this.verifyProfileOwnership(workflowId, profileName);
      return isOwned ? profileName : null;
    });
    const results = await Promise.all(ownershipChecks);
    return results.filter((name): name is string => name !== null);
  }

  private async verifyProfileOwnership(workflowId: string, profileName: string): Promise<boolean> {
    try {
      // Check if profile name follows our naming convention: {workflowId}_{agentId}
      const expectedPrefix = `${workflowId}_`;
      if (!profileName.startsWith(expectedPrefix)) {
        return false;
      }

      // Verify by checking if the profile has our marker
      const profilesDir = await this.getHermesProfilesDir();
      const profileDir = path.join(profilesDir, profileName);
      const antfarmMarker = path.join(profileDir, '.antfarm');

      try {
        const markerContent = await fs.readFile(antfarmMarker, 'utf-8');
        const marker: AntfarmMarker = JSON.parse(markerContent);
        return marker.workflowId === workflowId;
      } catch {
        // Marker doesn't exist, can't be read, or has wrong format - not owned by us
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
    const profilesDir = await this.getHermesProfilesDir();
    const profileDir = path.join(profilesDir, profileName);
    const workspaceDir = path.join(profileDir, 'workspace');

    await fs.mkdir(workspaceDir, { recursive: true });

    // Copy agent workspace files
    for (const [fileName, relativePath] of Object.entries(agent.workspace.files)) {
      const srcPath = path.resolve(sourceDir, relativePath);
      const dstPath = path.join(workspaceDir, fileName);
      await fs.copyFile(srcPath, dstPath);
    }
  }

  private async configureProfile(profileName: string, agent: WorkflowAgent): Promise<void> {
    // Use 'default' model to let Hermes backend decide (matches OpenClaw behavior)
    const model = agent.model ?? 'default';
    await exec('hermes', ['--profile', profileName, 'config', 'set', 'model.model', model]);

    // Set timeout - use ?? to preserve 0 as valid value
    const timeoutSeconds = String(agent.timeoutSeconds ?? 1800);
    await exec('hermes', ['--profile', profileName, 'config', 'set', 'timeout.seconds', timeoutSeconds]);

    // Set workspace path using the actual profile workspace directory
    const profilesDir = await this.getHermesProfilesDir();
    const profileDir = path.join(profilesDir, profileName);
    const workspaceDir = path.join(profileDir, 'workspace');
    await exec('hermes', ['--profile', profileName, 'config', 'set', 'terminal.cwd', workspaceDir]);
    await exec('hermes', ['--profile', profileName, 'config', 'set', 'terminal.backend', 'local']);

    // Install workspace skills if specified
    if (agent.workspace.skills && agent.workspace.skills.length > 0) {
      for (const skill of agent.workspace.skills) {
        await exec('hermes', ['--profile', profileName, 'skills', 'install', skill, '--yes']);
      }
    }
  }

  private async setupCron(profileName: string, workflowId: string, agentId: string): Promise<boolean> {
    const prompt = buildPollingPrompt(workflowId, agentId);
    const cronName = `antfarm/${workflowId}/${agentId}`;

    // Check if cron already exists by listing (idempotency)
    // Hermes output format: "No scheduled jobs." or list of jobs
    try {
      const { stdout } = await exec('hermes', ['--profile', profileName, 'cron', 'list']);
      if (stdout.includes(cronName)) {
        // Cron already exists, skip
        return false;
      }
    } catch {
      // If we can't list crons, proceed to try adding
    }

    // Use hermes cron add CLI
    await exec('hermes', [
      '--profile', profileName,
      'cron', 'add',
      '--name', cronName,
      '--every', '5m',
      '--prompt', prompt,
    ]);

    return true;
  }
}
