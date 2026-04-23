import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import type { Backend, BackendCapabilities, ValidationResult, PermissionAdapter, SpawnResult } from './interface.js';
import type { WorkflowSpec, WorkflowAgent } from '../installer/types.js';
import { provisionAgents } from '../installer/agent-provision.js';
import {
  writeRoleOverlayFile,
  removeRoleOverlayFiles,
  upsertAntfarmConfigBlock,
  removeWorkflowEntriesFromConfigBlock,
  parseAntfarmBlock,
  ANTFARM_BLOCK_BEGIN,
  ANTFARM_BLOCK_END,
  type AntfarmConfigEntry,
} from './codex-config.js';
import {
  getCodexSandboxMode,
  buildRoleDeveloperInstructions,
} from './codex-policy.js';
import {
  installAntfarmSkillForCodex,
  uninstallAntfarmSkillForCodex,
} from '../installer/skill-install.js';

const DEFAULT_MODEL = 'gpt-5.3-codex';
const DEFAULT_REASONING: 'low' | 'medium' | 'high' = 'high';

export function getCodexProfileName(workflowId: string, agentId: string): string {
  return `antfarm-${workflowId}_${agentId}`;
}

export class CodexBackend implements Backend {
  readonly capabilities: BackendCapabilities = {
    supportsPerToolDeny: false,  // Sandbox is coarse, not per-tool
    supportsSandbox: true,       // OS-level sandbox
    schedulerDriven: true,       // Uses SubprocessScheduler
    supportsCronManagement: false  // No cron
  };

  readonly permissionAdapter: PermissionAdapter = {
    async applyRoleConstraints(agent: WorkflowAgent): Promise<void> {
      // Set sandbox_mode in the role overlay file
      // This is handled during install via writeRoleOverlayFile
      const sandboxMode = getCodexSandboxMode(agent.role);
      // sandboxMode is stored in the role overlay file
    },

    async removeRoleConstraints(agentId: string): Promise<void> {
      // Cleanup is handled by removeRoleOverlayFiles
    }
  };

  async validate(workflow: WorkflowSpec): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Verify ~/.codex/ writable
    try {
      const codexHome = this.getCodexHome();
      await fs.access(codexHome).catch(async () => {
        await fs.mkdir(codexHome, { recursive: true });
      });

      // Test write access
      const testFile = path.join(codexHome, '.antfarm-test-write');
      await fs.writeFile(testFile, 'test', 'utf-8');
      await fs.unlink(testFile).catch(() => {});
    } catch (err) {
      errors.push(`Cannot write to Codex home directory: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Validate agent configurations
    for (const agent of workflow.agents) {
      // Check for unsafe agent keys
      if (workflow.id.includes('_') || agent.id.includes('_')) {
        errors.push(`Workflow or agent ID contains underscore: "${workflow.id}" / "${agent.id}"`);
      }
      const key = `${workflow.id}-${agent.id}`;
      if (key.includes('/') || key.includes('..') || key.includes('\\') || key.includes('"')) {
        errors.push(`Unsafe workflow/agent ID combination: "${workflow.id}" / "${agent.id}"`);
      }

      if (!agent.id || agent.id.trim() === '') {
        errors.push('Agent with empty ID found');
      }
    }

    // Check for duplicate agent IDs
    const agentIds = workflow.agents.map(a => a.id);
    const duplicates = agentIds.filter((id, index) => agentIds.indexOf(id) !== index);
    if (duplicates.length > 0) {
      errors.push(`Duplicate agent IDs: ${duplicates.join(', ')}`);
    }

    // Warn about Codex sandbox limitations
    warnings.push('Codex sandbox is coarse-grained; all roles use workspace-write with developer_instructions for guardrails');

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  async configureAgent(workflow: WorkflowSpec, agent: WorkflowAgent): Promise<void> {
    this.assertSafeAgentKey(workflow.id, agent.id);

    const overlayPath = this.overlayPath(workflow.id, agent.id);

    // Write role overlay file
    await writeRoleOverlayFile({
      filePath: overlayPath,
      model: agent.model ?? DEFAULT_MODEL,
      sandboxMode: getCodexSandboxMode(agent.role),
      modelReasoningEffort: DEFAULT_REASONING,
      developerInstructions: buildRoleDeveloperInstructions(agent.role, workflow.id, agent.id),
    });

    // Read existing entries for other workflows
    const existingEntries = await this.readExistingOtherWorkflowEntries(workflow.id);

    // Create new entry for this agent
    const newEntry: AntfarmConfigEntry = {
      profileName: this.profileName(workflow.id, agent.id),
      overlayPath,
      description: `antfarm ${workflow.id}/${agent.id} (${agent.role ?? 'coding'})`,
      sandboxMode: getCodexSandboxMode(agent.role),
      model: agent.model ?? DEFAULT_MODEL,
      reasoningEffort: DEFAULT_REASONING,
    };

    // Update config.toml
    await upsertAntfarmConfigBlock({
      configPath: this.getConfigPath(),
      entries: [...existingEntries, newEntry],
    });
  }

  async removeAgent(workflowId: string, agentId: string): Promise<void> {
    // Remove overlay file
    const overlayPath = this.overlayPath(workflowId, agentId);
    await fs.unlink(overlayPath).catch(() => {});

    // Remove from config.toml
    await removeWorkflowEntriesFromConfigBlock({
      configPath: this.getConfigPath(),
      workflowId,
    });
  }

  async spawnAgent(workflow: WorkflowSpec, agent: WorkflowAgent, prompt: string): Promise<SpawnResult> {
    // Direct spawn using codex exec
    // Import dynamically to avoid circular dependency
    const { spawnCodexProcess } = await import('./codex-spawn.js');

    const profileName = getCodexProfileName(workflow.id, agent.id);

    const result = await spawnCodexProcess({
      workspace: process.cwd(),
      profile: profileName,
      prompt,
    });

    return {
      success: result.success,
      output: result.stdout,
      error: result.stderr,
      exitCode: result.exitCode ?? 0
    };
  }

  private getCodexHome(): string {
    return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  }

  private getAgentsDir(): string {
    return path.join(this.getCodexHome(), 'agents');
  }

  private getConfigPath(): string {
    return path.join(this.getCodexHome(), 'config.toml');
  }

  private assertSafeAgentKey(workflowId: string, agentId: string): void {
    const key = `${workflowId}-${agentId}`;
    if (workflowId.includes('_') || agentId.includes('_')) {
      throw new Error(`Unsafe workflow/agent id combination: "${workflowId}" / "${agentId}" (underscores are reserved)`);
    }
    if (key.includes('/') || key.includes('..') || key.includes('\\') || key.includes('"')) {
      throw new Error(`Unsafe workflow/agent id combination: "${workflowId}" / "${agentId}"`);
    }
  }

  private profileName(workflowId: string, agentId: string): string {
    return getCodexProfileName(workflowId, agentId);
  }

  private overlayPath(workflowId: string, agentId: string): string {
    return path.join(this.getAgentsDir(), `${this.profileName(workflowId, agentId)}.toml`);
  }

  async install(workflow: WorkflowSpec, sourceDir: string): Promise<void> {
    await provisionAgents({
      workflow,
      workflowDir: sourceDir,
      bundledSourceDir: sourceDir,
    });

    const skillResult = await installAntfarmSkillForCodex();
    if (!skillResult.installed) {
      console.warn(
        `Failed to install antfarm-workflows skill to ${skillResult.path}. ` +
        `The workflow will run, but the Codex main agent won't surface /antfarm-workflows.`
      );
    }

    for (const agent of workflow.agents) {
      this.assertSafeAgentKey(workflow.id, agent.id);
      const overlayPath = this.overlayPath(workflow.id, agent.id);
      await writeRoleOverlayFile({
        filePath: overlayPath,
        model: agent.model ?? DEFAULT_MODEL,
        sandboxMode: getCodexSandboxMode(agent.role),
        modelReasoningEffort: DEFAULT_REASONING,
        developerInstructions: buildRoleDeveloperInstructions(agent.role, workflow.id, agent.id),
      });
    }

    const existingEntries = await this.readExistingOtherWorkflowEntries(workflow.id);
    const newEntries: AntfarmConfigEntry[] = workflow.agents.map((agent) => ({
      profileName: this.profileName(workflow.id, agent.id),
      overlayPath: this.overlayPath(workflow.id, agent.id),
      description: `antfarm ${workflow.id}/${agent.id} (${agent.role ?? 'coding'})`,
      sandboxMode: getCodexSandboxMode(agent.role),
      model: agent.model ?? DEFAULT_MODEL,
      reasoningEffort: DEFAULT_REASONING,
    }));
    await upsertAntfarmConfigBlock({
      configPath: this.getConfigPath(),
      entries: [...existingEntries, ...newEntries],
    });
  }

  async uninstall(workflowId: string): Promise<void> {
    await removeRoleOverlayFiles({ agentsDir: this.getAgentsDir(), workflowId });
    await removeWorkflowEntriesFromConfigBlock({
      configPath: this.getConfigPath(),
      workflowId,
    });

    const cfg = await fs.readFile(this.getConfigPath(), 'utf-8').catch(() => '');
    if (!cfg.includes(ANTFARM_BLOCK_BEGIN)) {
      await uninstallAntfarmSkillForCodex();
    }
  }

  async startRun(_workflow: WorkflowSpec): Promise<void> {
    // No-op in phase 1. Scheduler is a shared follow-up plan.
  }

  async stopRun(_workflow: WorkflowSpec): Promise<void> {
    // No-op in phase 1.
  }

  /**
   * Read current antfarm block and return entries NOT owned by `excludeWorkflowId`.
   * Used during install to preserve other workflows' entries when rewriting the block.
   */
  private async readExistingOtherWorkflowEntries(excludeWorkflowId: string): Promise<AntfarmConfigEntry[]> {
    const prefix = `antfarm-${excludeWorkflowId}_`;
    const cfg = await fs.readFile(this.getConfigPath(), 'utf-8').catch(() => '');
    if (!cfg.includes(ANTFARM_BLOCK_BEGIN)) return [];

    const beginIdx = cfg.indexOf(ANTFARM_BLOCK_BEGIN);
    const endIdx = cfg.indexOf(ANTFARM_BLOCK_END, beginIdx);
    if (endIdx === -1) return [];
    const block = cfg.slice(beginIdx, endIdx);
    return parseAntfarmBlock(block).filter((e) => !e.profileName.startsWith(prefix));
  }
}
