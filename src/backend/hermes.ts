import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import type { Backend, BackendCapabilities, ValidationResult, PermissionAdapter, SpawnResult } from './interface.js';
import type { WorkflowSpec, WorkflowAgent } from '../installer/types.js';
import { buildPollingPrompt } from '../installer/agent-cron.js';
import { installAntfarmSkillForHermes } from '../installer/skill-install.js';
import { writeWorkflowFile } from '../installer/workspace-files.js';

const defaultExec = promisify(execFile);

type HermesExec = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

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
  readonly capabilities: BackendCapabilities = {
    supportsPerToolDeny: false,  // Toolset only, no per-tool deny
    supportsSandbox: false,
    schedulerDriven: false,
    supportsCronManagement: true
  };

  readonly permissionAdapter: PermissionAdapter = {
    async applyRoleConstraints(_agent: WorkflowAgent): Promise<void> {
      // Hermes has no hard tool-level deny capability
      // Soft guardrails are applied via prompt injection only
      // This is handled in buildPollingPrompt
    },

    async removeRoleConstraints(_agentId: string): Promise<void> {
      // No explicit cleanup needed - role constraints are prompt-based
    }
  };

  async validate(workflow: WorkflowSpec): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Verify profile names are valid
    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);

      // Check for unsafe characters in profile names
      if (workflow.id.includes('_') || agent.id.includes('_')) {
        errors.push(`Workflow or agent ID contains underscore: "${workflow.id}" / "${agent.id}"`);
      }
      if (profileName.includes('/') || profileName.includes('\\') || profileName.includes('"')) {
        errors.push(`Invalid profile name characters: "${profileName}"`);
      }

      // Validate agent ID is not empty
      if (!agent.id || agent.id.trim() === '') {
        errors.push(`Agent with empty ID found`);
      }
    }

    // Warn about Hermes limitations
    warnings.push('Hermes does not support per-tool deny lists - using soft guardrails only');

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  async configureAgent(workflow: WorkflowSpec, agent: WorkflowAgent): Promise<void> {
    const profileName = getProfileName(workflow.id, agent.id);

    // Create profile
    await this.createProfile(workflow.id, profileName);

    // Create workspace
    await this.createWorkspace(workflow.id, profileName, workflow, agent, '');

    // Configure profile settings
    await this.configureProfile(profileName, agent);

    // Setup cron
    await this.setupCron(profileName, workflow.id, agent, workflow);
  }

  async removeAgent(workflowId: string, agentId: string): Promise<void> {
    const profileName = getProfileName(workflowId, agentId);

    // Verify ownership
    const isOwned = await this.verifyProfileOwnership(workflowId, profileName);
    if (!isOwned) {
      throw new Error(`Profile "${profileName}" does not belong to workflow "${workflowId}"`);
    }

    // Remove cron job
    const cronName = `antfarm/${workflowId}/${agentId}`;
    await this.removeCronByName(profileName, cronName).catch(() => {});

    // Stop gateway if running
    await this.exec('hermes', ['--profile', profileName, 'gateway', 'stop']).catch(() => {});

    // Delete profile
    await this.exec('hermes', ['profile', 'delete', profileName, '-y']);
  }

  constructor(private readonly exec: HermesExec = defaultExec as HermesExec) {}

  private async getHermesProfilesDir(): Promise<string> {
    // Try to get Hermes home from environment variable or use default
    const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
    return path.join(hermesHome, 'profiles');
  }

  async install(workflow: WorkflowSpec, sourceDir: string): Promise<void> {
    // Install the antfarm-workflows skill into the default Hermes profile so the
    // user's primary agent knows how to drive antfarm workflows. Idempotent —
    // overwrites SKILL.md on each call so template changes propagate.
    const skillResult = await installAntfarmSkillForHermes();
    if (!skillResult.installed) {
      console.warn(
        `Failed to install antfarm-workflows skill to ${skillResult.path}. ` +
        `The workflow will run, but the default Hermes profile won't expose /antfarm-workflows.`
      );
    }

    // Track every profile we created so rollback can clean up partial installs,
    // including the agent currently being processed (before all of its sub-steps finish).
    const installed: Array<{ profileName: string; agentId: string; hasCron: boolean }> = [];

    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);

      try {
        await this.createProfile(workflow.id, profileName);
        // Record as soon as the profile exists, so any later failure in this iteration
        // still gets rolled back.
        const record = { profileName, agentId: agent.id, hasCron: false };
        installed.push(record);

        await this.createWorkspace(workflow.id, profileName, workflow, agent, sourceDir);
        await this.configureProfile(profileName, agent);
        record.hasCron = await this.setupCron(profileName, workflow.id, agent, workflow);
      } catch (err) {
        await this.rollbackInstall(workflow.id, installed);
        throw err;
      }
    }
  }

  private async rollbackInstall(
    workflowId: string,
    installed: Array<{ profileName: string; agentId: string; hasCron: boolean }>
  ): Promise<void> {
    for (const { profileName, agentId, hasCron } of installed) {
      if (hasCron) {
        const cronName = `antfarm/${workflowId}/${agentId}`;
        await this.removeCronByName(profileName, cronName).catch(() => {});
      }
      // Note: install never starts the gateway, so we don't stop it here.
      await this.exec('hermes', ['profile', 'delete', profileName, '-y']).catch(() => {});
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

        // Explicitly remove the antfarm cron job before deleting the profile.
        // `hermes profile delete` likely cascades, but we don't rely on it — this
        // parallels rollbackInstall and makes the cleanup order deterministic.
        const agentId = profileName.slice(workflowId.length + 1);
        const cronName = `antfarm/${workflowId}/${agentId}`;
        await this.removeCronByName(profileName, cronName).catch((err) => {
          console.warn(`Failed to remove cron ${cronName}: ${err}`);
        });

        // Stop gateway if running
          await this.exec('hermes', ['--profile', profileName, 'gateway', 'stop']).catch((err) => {
            console.warn(`Failed to stop gateway for ${profileName}: ${err}`);
          });

        // Delete profile — name is positional for `profile delete`.
        await this.exec('hermes', ['profile', 'delete', profileName, '-y']);
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
        await this.exec('hermes', ['--profile', profileName, 'gateway', 'start']);
        started.push(profileName);
      }
    } catch (err) {
      for (const profileName of started) {
        await this.exec('hermes', ['--profile', profileName, 'gateway', 'stop']).catch(() => {});
      }
      throw err;
    }
  }

  async stopRun(workflow: WorkflowSpec): Promise<void> {
    for (const agent of workflow.agents) {
      const profileName = getProfileName(workflow.id, agent.id);
      try {
        await this.exec('hermes', ['--profile', profileName, 'gateway', 'stop']);
      } catch (err) {
        console.warn(`Failed to stop gateway for ${profileName}: ${err}`);
      }
    }
  }

  /**
   * Validate a profile name resolves inside the profiles dir — guards against
   * agent ids containing `..` or path separators escaping onto the filesystem.
   */
  private async assertSafeProfilePath(profileName: string): Promise<string> {
    const profilesDir = await this.getHermesProfilesDir();
    const profileDir = path.resolve(profilesDir, profileName);
    const rel = path.relative(profilesDir, profileDir);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `Unsafe profile name "${profileName}" — resolves outside the Hermes profiles directory.`
      );
    }
    return profileDir;
  }

  private async createProfile(workflowId: string, profileName: string): Promise<void> {
    // Reject agent ids that would escape the profiles dir (e.g. "../", "/etc").
    const profileDir = await this.assertSafeProfilePath(profileName);

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
    await this.exec('hermes', ['profile', 'create', profileName, '--clone', '--clone-from', 'default']);

    // Write marker immediately to mark profile as antfarm-owned before any further work.
    // If marker write fails (disk full, permissions, process killed), roll back the profile
    // to avoid leaving an un-markered profile that future installs would reject as "belongs
    // to a different workflow."
    const marker: AntfarmMarker = {
      workflowId,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    try {
      await fs.writeFile(path.join(profileDir, '.antfarm'), JSON.stringify(marker), 'utf-8');
    } catch (err) {
      await this.exec('hermes', ['profile', 'delete', profileName, '-y']).catch(() => {});
      throw new Error(
        `Failed to write antfarm ownership marker for profile "${profileName}". ` +
        `Profile was rolled back. Original error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
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
    sourceDir: string,
    bundledSourceDir?: string
  ): Promise<void> {
    // Guard against unsafe agent ids before touching the filesystem.
    const profileDir = await this.assertSafeProfilePath(profileName);
    const workspaceDir = path.join(profileDir, 'workspace');
    await fs.mkdir(workspaceDir, { recursive: true });

    // Copy each declared file. Try sourceDir first; if the relative path
    // escapes sourceDir (e.g. `../../agents/shared/foo.md`) fall back to the
    // bundled source dir — same pattern as provisionAgents() on OpenClaw.
    for (const [fileName, relativePath] of Object.entries(agent.workspace.files)) {
      let srcPath = path.resolve(sourceDir, relativePath);
      try {
        await fs.access(srcPath);
      } catch {
        if (bundledSourceDir) {
          srcPath = path.resolve(bundledSourceDir, relativePath);
          try {
            await fs.access(srcPath);
          } catch {
            throw new Error(`Missing bootstrap file for agent "${agent.id}": ${relativePath}`);
          }
        } else {
          throw new Error(`Missing bootstrap file for agent "${agent.id}": ${relativePath}`);
        }
      }
      // writeWorkflowFile creates parent dirs, so fileName may contain sub-paths.
      const destination = path.join(workspaceDir, fileName);
      await writeWorkflowFile({ destination, source: srcPath, overwrite: true });
    }

    // If the agent declares workspace skills, ensure the skills/ subdir exists
    // for any downstream consumers that expect it (mirrors provisionAgents).
    if (agent.workspace.skills?.length) {
      await fs.mkdir(path.join(workspaceDir, 'skills'), { recursive: true });
    }
  }

  private async configureProfile(profileName: string, agent: WorkflowAgent): Promise<void> {
    // Use 'default' model to let Hermes backend decide (matches OpenClaw behavior)
    const model = agent.model ?? 'default';
    await this.exec('hermes', ['--profile', profileName, 'config', 'set', 'model.model', model]);

    // Set timeout - use ?? to preserve 0 as valid value
    const timeoutSeconds = String(agent.timeoutSeconds ?? 1800);
    await this.exec('hermes', ['--profile', profileName, 'config', 'set', 'timeout.seconds', timeoutSeconds]);

    // Set workspace path using the actual profile workspace directory
    const profilesDir = await this.getHermesProfilesDir();
    const profileDir = path.join(profilesDir, profileName);
    const workspaceDir = path.join(profileDir, 'workspace');
    await this.exec('hermes', ['--profile', profileName, 'config', 'set', 'terminal.cwd', workspaceDir]);
    await this.exec('hermes', ['--profile', profileName, 'config', 'set', 'terminal.backend', 'local']);

    // Install workspace skills if specified.
    // --yes skips confirmation; --force overrides security scanner blocks for
    // community-source skills (e.g. agent-browser from skills-sh is flagged
    // CAUTION by default).
    if (agent.workspace.skills && agent.workspace.skills.length > 0) {
      const installed = await this.listInstalledSkillNames(profileName);
      for (const skill of agent.workspace.skills) {
        // Idempotency: skip if the skill name already appears in `skills list`.
        // Hermes skills install uses identifiers like `owner/skills/name` — we
        // match by the trailing slug since that's what `skills list` prints.
        const slug = skill.split('/').pop() ?? skill;
        if (installed.has(slug)) continue;
        await this.exec('hermes', ['--profile', profileName, 'skills', 'install', skill, '--yes', '--force']);
      }
    }
  }

  /**
   * List installed skill slugs for a profile by parsing `hermes skills list`
   * (Name column of the table). Returns an empty set on failure — callers
   * fall back to attempting an install and letting Hermes surface errors.
   */
  private async listInstalledSkillNames(profileName: string): Promise<Set<string>> {
    try {
      const { stdout } = await this.exec('hermes', ['--profile', profileName, 'skills', 'list']);
      const names = new Set<string>();
      for (const line of stdout.split('\n')) {
        // Rows look like: │ <name> │ <category> │ <source> │ <trust> │
        const m = line.match(/^\s*│\s*([a-zA-Z0-9][a-zA-Z0-9_\-]*)\s*│/);
        if (m) names.add(m[1]);
      }
      return names;
    } catch {
      return new Set();
    }
  }

  private async setupCron(
    profileName: string,
    workflowId: string,
    agent: WorkflowAgent,
    workflow: WorkflowSpec,
  ): Promise<boolean> {
    // Work-session model (spawned by the polling loop): per-agent > workflow polling
    // default > Hermes default. Polling-phase model resolution is ignored here —
    // `hermes cron create` has no per-job model flag, so the polling phase runs on
    // whatever the profile's model.model is set to (see configureProfile).
    const workModel = agent.model ?? workflow.polling?.model ?? 'default';
    const prompt = buildPollingPrompt(workflowId, agent.id, workModel, agent.role);
    const cronName = `antfarm/${workflowId}/${agent.id}`;

    // Idempotency: skip if a cron with the same name is already scheduled.
    const existing = await this.findCronJobId(profileName, cronName);
    if (existing) return false;

    // Correct invocation: `hermes cron create <schedule> <prompt> --name <name>`
    // (schedule and prompt are positional — there are no `--every` / `--prompt` flags.
    // Also no `--timeout` — cron tasks inherit the profile's terminal.timeout.)
    await this.exec('hermes', [
      '--profile', profileName,
      'cron', 'create',
      'every 5m',
      prompt,
      '--name', cronName,
    ]);

    return true;
  }

  /**
   * Parse `hermes cron list` output and return the job_id whose Name matches,
   * or null if no such job is scheduled. No --json output exists as of Hermes
   * 0.10, so we parse the human-readable format:
   *   <job_id> [active]
   *       Name:      <cron_name>
   *       Schedule:  ...
   * Job ids are hex-like but we don't hardcode a length — Hermes may shorten
   * or lengthen them. Any leading hex token (≥6 chars) followed by a `[` is
   * treated as a job id.
   */
  private async findCronJobId(profileName: string, cronName: string): Promise<string | null> {
    let stdout = '';
    try {
      ({ stdout } = await this.exec('hermes', ['--profile', profileName, 'cron', 'list']));
    } catch {
      return null;
    }
    const lines = stdout.split('\n');
    let currentId: string | null = null;
    for (const line of lines) {
      const idMatch = line.match(/^\s*([a-f0-9]{6,})\s+\[/i);
      if (idMatch) {
        currentId = idMatch[1];
        continue;
      }
      const nameMatch = line.match(/^\s*Name:\s+(.+)$/);
      if (nameMatch && currentId && nameMatch[1].trim() === cronName) {
        return currentId;
      }
    }
    return null;
  }

  /**
   * Remove a cron job by its human-readable name. `hermes cron remove` takes
   * a job_id positional, so we have to look up the id via `cron list` first.
   */
  private async removeCronByName(profileName: string, cronName: string): Promise<void> {
    const jobId = await this.findCronJobId(profileName, cronName);
    if (!jobId) return;
    await this.exec('hermes', ['--profile', profileName, 'cron', 'remove', jobId]);
  }
}
