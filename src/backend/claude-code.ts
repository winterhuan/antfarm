import fs from 'node:fs/promises';
import path from 'node:path';

import type { Backend } from './interface.js';
import type { WorkflowSpec } from '../installer/types.js';
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
