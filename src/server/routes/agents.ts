import type { IncomingMessage, ServerResponse } from "node:http";
import {
  checkBackendAvailability,
  getAllWorkflowAgents,
  getHermesWorkflowAgents,
  getClaudeCodeWorkflowAgents,
  getCodexWorkflowAgents,
  getOpenClawWorkflowAgents,
  type BackendType,
} from "../status-checker.js";

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

// GET /api/agents?workflow=<id>
// GET /api/agents/:workflowId
async function handleListAgents(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const workflowId = url.searchParams.get("workflow") || url.pathname.split("/").pop();

  if (!workflowId || workflowId === "agents") {
    return json(res, { error: "Missing workflow ID" }, 400);
  }

  try {
    const agents = await getAllWorkflowAgents(workflowId);
    return json(res, agents);
  } catch (error) {
    return json(res, { error: String(error) }, 500);
  }
}

// GET /api/agents/by-backend/:backend?workflow=<id>
async function handleListByBackend(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const parts = url.pathname.split("/");
  const backend = parts[parts.indexOf("by-backend") + 1] as BackendType;
  const workflowId = url.searchParams.get("workflow") || parts[parts.length - 1];

  if (!backend || !["hermes", "claude-code", "codex", "openclaw"].includes(backend)) {
    return json(res, { error: "Invalid or missing backend type" }, 400);
  }

  if (!workflowId) {
    return json(res, { error: "Missing workflow ID" }, 400);
  }

  try {
    let agents: Awaited<ReturnType<typeof getAllWorkflowAgents>> = [];

    switch (backend) {
      case "hermes":
        agents = await getHermesWorkflowAgents(workflowId);
        break;
      case "claude-code":
        agents = await getClaudeCodeWorkflowAgents(workflowId);
        break;
      case "codex":
        agents = await getCodexWorkflowAgents(workflowId);
        break;
      case "openclaw":
        agents = await getOpenClawWorkflowAgents(workflowId);
        break;
    }

    return json(res, agents);
  } catch (error) {
    return json(res, { error: String(error) }, 500);
  }
}

// POST /api/agents/:agentId/stop
async function handleStopAgent(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  // For now, return not implemented - this would need backend integration
  return json(res, { error: "Not implemented" }, 501);
}

// POST /api/agents/:agentId/start
async function handleStartAgent(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  // For now, return not implemented - this would need backend integration
  return json(res, { error: "Not implemented" }, 501);
}

export function handle(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const pathname = url.pathname;
  const method = req.method || "GET";

  // Route: /api/agents/by-backend/:backend
  if (pathname.includes("/by-backend/")) {
    if (method === "GET") {
      return void handleListByBackend(req, res, url);
    }
    return json(res, { error: "Method not allowed" }, 405);
  }

  // Route: /api/agents/:agentId/stop
  if (pathname.endsWith("/stop")) {
    if (method === "POST") {
      return void handleStopAgent(req, res, url);
    }
    return json(res, { error: "Method not allowed" }, 405);
  }

  // Route: /api/agents/:agentId/start
  if (pathname.endsWith("/start")) {
    if (method === "POST") {
      return void handleStartAgent(req, res, url);
    }
    return json(res, { error: "Method not allowed" }, 405);
  }

  // Route: /api/agents or /api/agents/:workflowId
  if (method === "GET") {
    return void handleListAgents(req, res, url);
  }

  return json(res, { error: "Not found" }, 404);
}

// GET /api/backends/status
export async function handleBackends(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method || "GET";

  if (method !== "GET") {
    return json(res, { error: "Method not allowed" }, 405);
  }

  try {
    const backends = await checkBackendAvailability();
    return json(res, backends);
  } catch (error) {
    return json(res, { error: String(error) }, 500);
  }
}
