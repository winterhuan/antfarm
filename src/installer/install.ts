import fs from "node:fs/promises";
import path from "node:path";
import { fetchWorkflow } from "./workflow-fetch.js";
import { loadWorkflowSpec } from "./workflow-spec.js";
import type { WorkflowInstallResult } from "./types.js";
import { createBackend } from "../backend/index.js";
import type { BackendType } from "../backend/interface.js";

async function writeWorkflowMetadata(params: { workflowDir: string; workflowId: string; source: string }) {
  const content = { workflowId: params.workflowId, source: params.source, installedAt: new Date().toISOString() };
  await fs.writeFile(path.join(params.workflowDir, "metadata.json"), `${JSON.stringify(content, null, 2)}\n`, "utf-8");
}

export async function installWorkflow(params: { workflowId: string; backend?: BackendType }): Promise<WorkflowInstallResult> {
  const { workflowDir, bundledSourceDir } = await fetchWorkflow(params.workflowId);
  const workflow = await loadWorkflowSpec(workflowDir);

  // Resolve backend: CLI arg > workflow default > global default
  const backendType = params.backend ?? workflow.defaultBackend ?? 'openclaw';
  const backend = createBackend(backendType);

  // Delegate to backend-specific installation
  await backend.install(workflow, bundledSourceDir);

  // Write workflow metadata (backend-agnostic)
  await writeWorkflowMetadata({ workflowDir, workflowId: workflow.id, source: `bundled:${params.workflowId}` });

  return { workflowId: workflow.id, workflowDir };
}
