import type { Backend } from './interface.js';
import type { WorkflowSpec } from '../installer/types.js';
import { provisionAgents } from '../installer/agent-provision.js';
import { createAgentCronJob, deleteAgentCronJobs } from '../installer/gateway-api.js';
import { buildPollingPrompt } from '../installer/agent-cron.js';

export class OpenClawBackend implements Backend {
  async install(workflow: WorkflowSpec, sourceDir: string): Promise<void> {
    // Provision agent workspaces
    await provisionAgents({
      workflow,
      workflowDir: sourceDir,
      bundledSourceDir: sourceDir,
    });

    // Create cron jobs for each agent
    for (const agent of workflow.agents) {
      const agentId = `${workflow.id}_${agent.id}`;
      const cronName = `antfarm/${workflow.id}/${agent.id}`;

      await createAgentCronJob({
        name: cronName,
        schedule: { kind: 'every', everyMs: 300000 },
        sessionTarget: 'isolated',
        agentId,
        payload: {
          kind: 'agentTurn',
          message: buildPollingPrompt(workflow.id, agent.id),
          model: agent.model ?? 'default',
          timeoutSeconds: agent.timeoutSeconds ?? 1800,
        },
        delivery: { mode: 'none' },
        enabled: true,
      });
    }
  }

  async uninstall(workflowId: string): Promise<void> {
    await deleteAgentCronJobs(`antfarm/${workflowId}/`);
    // Workspaces are cleaned up separately
  }

  async startRun(workflow: WorkflowSpec): Promise<void> {
    // OpenClaw Gateway is already running, nothing to do
  }

  async stopRun(workflow: WorkflowSpec): Promise<void> {
    // Optionally stop cron jobs
    await deleteAgentCronJobs(`antfarm/${workflow.id}/`);
  }
}
