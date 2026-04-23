import fs from 'node:fs/promises';
import path from 'node:path';

import type { Backend, BackendCapabilities, ValidationResult, PermissionAdapter, SpawnResult } from './interface.js';
import type { WorkflowSpec, WorkflowAgent } from '../installer/types.js';
import { provisionAgents } from '../installer/agent-provision.js';
import {
  writeSubagentDefinition,
  removeSubagentDefinition,
} from './claude-code-install.js';
import { buildDisallowedTools } from './claude-code-policy.js';
import { resolveWorkflowDir } from '../installer/paths.js';
import {
  installAntfarmSkillForClaudeCode,
  uninstallAntfarmSkillForClaudeCode,
} from '../installer/skill-install.js';

const PROJECT_MARKER_NAME = '.claude-project-dir';

/**
 * Read the recorded projectDir for a Claude Code workflow. Written at install
 * time so `uninstallAllWorkflows` (which may run from a different cwd) can
 * target the correct project's .claude/ directory.
 */
export async function readClaudeCodeProjectDir(workflowId: string): Promise<string | null> {
  const marker = path.join(resolveWorkflowDir(workflowId), PROJECT_MARKER_NAME);
  try {
    const raw = (await fs.readFile(marker, 'utf-8')).trim();
    return raw || null;
  } catch {
    return null;
  }
}

export class ClaudeCodeBackend implements Backend {
  readonly capabilities: BackendCapabilities = {
    supportsPerToolDeny: true,  // --disallowedTools flag
    supportsSandbox: false,
    schedulerDriven: true,        // Uses SubprocessScheduler
    supportsCronManagement: false   // No cron, scheduler-driven
  };

  readonly permissionAdapter: PermissionAdapter = {
    async applyRoleConstraints(agent: WorkflowAgent): Promise<void> {
      // Writes disallowedTools to .claude/agents/<workflowId>_<agentId>.md frontmatter
      const disallowedTools = buildDisallowedTools(agent.role);
      // This is handled during install via writeSubagentDefinition
    },

    async removeRoleConstraints(agentId: string): Promise<void> {
      // Remove agent file if it exists
      // Actual cleanup is done in removeAgent
    }
  };

  async validate(workflow: WorkflowSpec): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check .claude/ writable by checking projectDir
    try {
      const agentsDir = path.join(this.projectDir, '.claude', 'agents');
      await fs.access(agentsDir).catch(async () => {
        // Try to create the directory
        await fs.mkdir(agentsDir, { recursive: true });
      });
    } catch (err) {
      errors.push(`Cannot access or create .claude/agents directory: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Validate agent configurations
    for (const agent of workflow.agents) {
      if (!agent.id || agent.id.trim() === '') {
        errors.push('Agent with empty ID found');
      }

      // Check for valid role
      const validRoles = ['analysis', 'coding', 'verification', 'testing', 'pr', 'scanning'];
      if (agent.role && !validRoles.includes(agent.role)) {
        warnings.push(`Unknown role "${agent.role}" for agent "${agent.id}"`);
      }
    }

    // Check for duplicate agent IDs
    const agentIds = workflow.agents.map(a => a.id);
    const duplicates = agentIds.filter((id, index) => agentIds.indexOf(id) !== index);
    if (duplicates.length > 0) {
      errors.push(`Duplicate agent IDs: ${duplicates.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  async configureAgent(workflow: WorkflowSpec, agent: WorkflowAgent): Promise<void> {
    // Create .claude/agents/<workflowId>_<agentId>.md
    await writeSubagentDefinition({
      projectDir: this.projectDir,
      workflowId: workflow.id,
      agentId: agent.id,
      role: agent.role ?? 'coding',
      description: agent.description ?? `${workflow.id} ${agent.id}`,
      disallowedTools: buildDisallowedTools(agent.role) || undefined,
    });

    // Record project ownership
    try {
      await fs.writeFile(
        path.join(resolveWorkflowDir(workflow.id), PROJECT_MARKER_NAME),
        this.projectDir,
        'utf-8',
      );
    } catch {
      // Non-fatal: fallback still handles common case
    }
  }

  async removeAgent(workflowId: string, agentId: string): Promise<void> {
    await removeSubagentDefinition({ projectDir: this.projectDir, workflowId, agentId });
  }

  async spawnAgent(workflow: WorkflowSpec, agent: WorkflowAgent, prompt: string): Promise<SpawnResult> {
    // Direct spawn using claude -p
    // Import dynamically to avoid circular dependency
    const { spawnClaudeProcess } = await import('./claude-code-spawn.js');

    const result = await spawnClaudeProcess({
      workspace: this.projectDir,
      agentId: `${workflow.id}_${agent.id}`,
      prompt,
      disallowedTools: buildDisallowedTools(agent.role),
    });

    return {
      success: result.success,
      output: result.stdout,
      error: result.stderr,
      exitCode: result.exitCode ?? 0
    };
  }

  /**
   * @param projectDir directory containing `.claude/` — defaults to
   *   process.cwd() at construction time. Tests inject a tmp dir directly.
   */
  constructor(private readonly projectDir: string = process.cwd()) {}

  async install(workflow: WorkflowSpec, sourceDir: string): Promise<void> {
    await provisionAgents({
      workflow,
      workflowDir: sourceDir,
      bundledSourceDir: sourceDir,
    });

    // 1. Install the antfarm-workflows skill (main-agent entry point).
    const skillResult = await installAntfarmSkillForClaudeCode(this.projectDir);
    if (!skillResult.installed) {
      console.warn(
        `Failed to install antfarm-workflows skill to ${skillResult.path}. ` +
        `The workflow will run, but the main Claude Code agent won't expose /antfarm-workflows.`
      );
    }

    // 2. Write one subagent definition per workflow agent. Per-role
    //    `disallowedTools` goes into the subagent frontmatter — Claude Code
    //    enforces it per-agent on interactive Task-tool delegation. The
    //    autonomous scheduler path passes `--disallowedTools` on the CLI.
    for (const agent of workflow.agents) {
      await writeSubagentDefinition({
        projectDir: this.projectDir,
        workflowId: workflow.id,
        agentId: agent.id,
        role: agent.role ?? 'coding',
        description: agent.description ?? `${workflow.id} ${agent.id}`,
        disallowedTools: buildDisallowedTools(agent.role) || undefined,
      });
    }

    // 3. Record which project owns this workflow's .claude/ artifacts so
    //    `uninstallAllWorkflows` can find them even when invoked from a
    //    different cwd.
    try {
      await fs.writeFile(
        path.join(resolveWorkflowDir(workflow.id), PROJECT_MARKER_NAME),
        this.projectDir,
        'utf-8',
      );
    } catch {
      // workflowDir is created by installWorkflow before backend.install is
      // called; if this write fails something is deeply wrong, but don't let
      // it block the install — the cwd fallback still handles the common case.
    }
  }

  async uninstall(workflowId: string): Promise<void> {
    // Without a workflow spec (uninstall is called by id), discover agents by
    // scanning .claude/agents/ for files matching `<workflowId>_*.md`.
    const agentsDir = path.join(this.projectDir, '.claude', 'agents');
    let entries: string[] = [];
    try { entries = await fs.readdir(agentsDir); } catch { /* dir missing is fine */ }
    const prefix = `${workflowId}_`;
    for (const name of entries) {
      if (!name.startsWith(prefix) || !name.endsWith('.md')) continue;
      const agentId = name.slice(prefix.length, -'.md'.length);
      await removeSubagentDefinition({ projectDir: this.projectDir, workflowId, agentId });
    }
    await uninstallAntfarmSkillForClaudeCode(this.projectDir);
  }

  async startRun(_workflow: WorkflowSpec): Promise<void> {
    // No-op: Claude Code is driven by the antfarm SubprocessScheduler (see
    // src/server/subprocess-scheduler.ts), which polls the DB for pending
    // steps and spawns `claude -p` subprocesses.
  }

  async stopRun(_workflow: WorkflowSpec): Promise<void> {
    // No-op: SubprocessScheduler reaps children when the run status flips.
  }
}
