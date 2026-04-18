import fs from 'node:fs/promises';
import path from 'node:path';

import type { Backend } from './interface.js';
import type { WorkflowSpec } from '../installer/types.js';
import {
  writeSubagentDefinition,
  removeSubagentDefinition,
  upsertClaudeSettingsPermissions,
  removeClaudeSettingsPermissions,
} from './claude-code-install.js';
import { buildDisallowedTools } from './claude-code-policy.js';
import {
  installAntfarmSkillForClaudeCode,
  uninstallAntfarmSkillForClaudeCode,
} from '../installer/skill-install.js';

export class ClaudeCodeBackend implements Backend {
  /**
   * @param projectDir directory containing `.claude/` — defaults to
   *   process.cwd() at construction time. Tests inject a tmp dir directly.
   */
  constructor(private readonly projectDir: string = process.cwd()) {}

  async install(workflow: WorkflowSpec, _sourceDir: string): Promise<void> {
    // 1. Install the antfarm-workflows skill (main-agent entry point).
    const skillResult = await installAntfarmSkillForClaudeCode(this.projectDir);
    if (!skillResult.installed) {
      console.warn(
        `Failed to install antfarm-workflows skill to ${skillResult.path}. ` +
        `The workflow will run, but the main Claude Code agent won't expose /antfarm-workflows.`
      );
    }

    // 2. Write one subagent definition per workflow agent.
    for (const agent of workflow.agents) {
      await writeSubagentDefinition({
        projectDir: this.projectDir,
        workflowId: workflow.id,
        agentId: agent.id,
        role: agent.role ?? 'coding',
        description: agent.description ?? `${workflow.id} ${agent.id}`,
      });
    }

    // 3. Merge per-role disallowed tools into .claude/settings.json as a
    //    hard permission boundary (belt-and-suspenders with CLI flag).
    const unionDeny = new Set<string>();
    for (const agent of workflow.agents) {
      const denyStr = buildDisallowedTools(agent.role);
      if (denyStr) denyStr.split(',').forEach((t) => unionDeny.add(t));
    }
    if (unionDeny.size > 0) {
      await upsertClaudeSettingsPermissions({
        projectDir: this.projectDir,
        deny: Array.from(unionDeny),
      });
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
    await removeClaudeSettingsPermissions({ projectDir: this.projectDir });
    await uninstallAntfarmSkillForClaudeCode(this.projectDir);
  }

  async startRun(_workflow: WorkflowSpec): Promise<void> {
    // No-op in this phase. Scheduler comes in a follow-up plan.
  }

  async stopRun(_workflow: WorkflowSpec): Promise<void> {
    // No-op in this phase.
  }
}
