import type { BackendType } from "./interface.js";
import type { WorkflowSpec, WorkflowAgent } from "../installer/types.js";
import { resolveBackendConfig } from "./config-resolver.js";

/**
 * Group workflow agents by their resolved backend type.
 * Respects full resolver priority: CLI > agent > workflow > global > default
 */
export async function groupAgentsByBackend(
  workflow: WorkflowSpec,
  cliBackend?: BackendType
): Promise<Map<BackendType, WorkflowAgent[]>> {
  const agentsByBackend = new Map<BackendType, WorkflowAgent[]>();

  for (const agent of workflow.agents) {
    const resolved = await resolveBackendConfig(agent, workflow, cliBackend);
    const list = agentsByBackend.get(resolved.type) ?? [];
    list.push(agent);
    agentsByBackend.set(resolved.type, list);
  }

  return agentsByBackend;
}
