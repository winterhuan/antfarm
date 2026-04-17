import fs from "node:fs/promises";
import path from "node:path";
import { fetchWorkflow } from "./workflow-fetch.js";
import { loadWorkflowSpec } from "./workflow-spec.js";
import type { WorkflowInstallResult } from "./types.js";
import { createBackend, groupAgentsByBackend } from "../backend/index.js";
import type { BackendType } from "../backend/interface.js";

async function writeWorkflowMetadata(params: { workflowDir: string; workflowId: string; source: string }) {
  const content = { workflowId: params.workflowId, source: params.source, installedAt: new Date().toISOString() };
  await fs.writeFile(path.join(params.workflowDir, "metadata.json"), `${JSON.stringify(content, null, 2)}\n`, "utf-8");
}

export async function installWorkflow(params: { workflowId: string; backend?: BackendType }): Promise<WorkflowInstallResult> {
  const { workflowDir, bundledSourceDir } = await fetchWorkflow(params.workflowId);
  const workflow = await loadWorkflowSpec(workflowDir);

  if (workflow.agents.length === 0) {
    throw new Error(`Workflow ${workflow.id} has no agents defined`);
  }

  // Resolve backend per-agent and group by type (CLI > agent > workflow > global > default)
  const agentsByBackend = await groupAgentsByBackend(workflow, params.backend);

  // Install each backend group separately
  // NOTE: Keep this loop serial to avoid race conditions in createProfile
  for (const [backendType, agents] of agentsByBackend) {
    const backend = createBackend(backendType);
    // Create a sub-workflow with only this backend's agents
    const subWorkflow = { ...workflow, agents };
    await backend.install(subWorkflow, bundledSourceDir);
  }

  // Write workflow metadata (backend-agnostic)
  await writeWorkflowMetadata({ workflowDir, workflowId: workflow.id, source: `bundled:${params.workflowId}` });

  return { workflowId: workflow.id, workflowDir };
}
