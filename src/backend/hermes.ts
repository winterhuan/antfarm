import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';

import type { Backend } from './interface.js';
import type { WorkflowSpec, WorkflowAgent } from '../installer/types.js';
import { buildPollingPrompt } from '../installer/agent-cron.js';

const exec = promisify(execFile);

export function getProfileName(workflowId: string, agentId: string): string {
  return `${workflowId}-${agentId}`;
}

export interface HermesCronJob {
  id: string;
  name: string;
  schedule: { kind: string; everyMs: number };
  prompt: string;
  enabled: boolean;
}

export function createCronJob(
  workflowId: string,
  agentId: string,
  prompt: string
): HermesCronJob {
  return {
    id: `antfarm-${workflowId}-${agentId}`,
    name: `antfarm/${workflowId}/${agentId}`,
    schedule: { kind: 'every', everyMs: 300000 },
    prompt,
    enabled: true,
  };
}

export class HermesBackend implements Backend {
  async install(workflow: WorkflowSpec, sourceDir: string): Promise<void> {
    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);

      // Create Hermes profile
      await this.createProfile(profileName);

      // Create workspace
      await this.createWorkspace(profileName, workflow, agent, sourceDir);

      // Configure profile
      await this.configureProfile(profileName, agent);

      // Setup cron
      await this.setupCron(profileName, workflow.id, agent.id);
    }
  }

  async uninstall(workflowId: string): Promise<void> {
    // Find all profiles for this workflow
    const profiles = await this.listWorkflowProfiles(workflowId);

    for (const profileName of profiles) {
      try {
        // Stop gateway if running
        await exec('sh', ['-c', `${profileName} gateway stop || true`]);

        // Delete profile
        await exec('hermes', ['profile', 'delete', profileName, '--yes']);
      } catch {
        // Profile may not exist, ignore errors
      }
    }
  }

  async startRun(workflow: WorkflowSpec): Promise<void> {
    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);
      await exec('sh', ['-c', `${profileName} gateway start`]);
    }
  }

  async stopRun(workflow: WorkflowSpec): Promise<void> {
    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);
      await exec('sh', ['-c', `${profileName} gateway stop || true`]);
    }
  }

  private async createProfile(profileName: string): Promise<void> {
    try {
      await exec('hermes', ['profile', 'create', profileName, '--clone', '--clone-from', 'default']);
    } catch (error) {
      // Profile may already exist, try to use it
      const { stdout } = await exec('hermes', ['profile', 'list']);
      if (!stdout.includes(profileName)) {
        throw error;
      }
    }
  }

  private async createWorkspace(
    profileName: string,
    workflow: WorkflowSpec,
    agent: WorkflowAgent,
    sourceDir: string
  ): Promise<void> {
    const profileDir = path.join(os.homedir(), '.hermes', 'profiles', profileName);
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
    const profileDir = path.join(os.homedir(), '.hermes', 'profiles', profileName);
    const configPath = path.join(profileDir, 'config.yaml');

    const config = {
      model: {
        model: agent.model || 'anthropic/claude-sonnet-4',
      },
      terminal: {
        backend: 'local',
        cwd: '/workspace',
      },
      timeout: {
        seconds: agent.timeoutSeconds || 1800,
      },
    };

    await fs.writeFile(configPath, YAML.stringify(config));
  }

  private async setupCron(profileName: string, workflowId: string, agentId: string): Promise<void> {
    const prompt = buildPollingPrompt(workflowId, agentId);
    const cronJob = createCronJob(workflowId, agentId, prompt);

    const profileDir = path.join(os.homedir(), '.hermes', 'profiles', profileName);
    const cronDir = path.join(profileDir, 'cron');
    const jobsPath = path.join(cronDir, 'jobs.json');

    await fs.mkdir(cronDir, { recursive: true });
    await fs.writeFile(jobsPath, JSON.stringify([cronJob], null, 2));
  }

  private async listWorkflowProfiles(workflowId: string): Promise<string[]> {
    try {
      const { stdout } = await exec('hermes', ['profile', 'list']);
      return stdout.split('\n')
        .filter(line => line.startsWith(`${workflowId}-`))
        .map(line => line.trim().split(' ')[0]);
    } catch {
      return [];
    }
  }
}
