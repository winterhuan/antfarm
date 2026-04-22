import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import type { Backend } from './interface.js';
import type { WorkflowSpec } from '../installer/types.js';
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
