import type { IncomingMessage, ServerResponse } from "node:http";
import type { BackendType } from "../../backend/interface.js";
import { runWorkflow } from "../../installer/run.js";
import { resolveBundledWorkflowsDir } from "../../installer/paths.js";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

interface WorkflowDef {
  id: string;
  name: string;
  description?: string;
  steps: Array<{ id: string; agent: string }>;
  agents: Array<{ id: string; name?: string; role?: string }>;
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { resolve(body); });
    req.on("error", reject);
  });
}

function loadWorkflows(): WorkflowDef[] {
  const dir = resolveBundledWorkflowsDir();
  const results: WorkflowDef[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const ymlPath = path.join(dir, entry.name, "workflow.yml");
      if (!fs.existsSync(ymlPath)) continue;
      const parsed = YAML.parse(fs.readFileSync(ymlPath, "utf-8"));
      results.push({
        id: parsed.id ?? entry.name,
        name: parsed.name ?? entry.name,
        description: parsed.description,
        steps: (parsed.steps ?? []).map((s: any) => ({ id: s.id, agent: s.agent })),
        agents: (parsed.agents ?? []).map((a: any) => ({ id: a.id, name: a.name, role: a.role })),
      });
    }
  } catch { /* empty */ }
  return results;
}

// GET /api/launch/config
async function handleGetConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const workflows = loadWorkflows();
    const backends: BackendType[] = ["hermes", "claude-code", "codex", "openclaw"];

    return json(res, {
      workflows,
      backends,
      defaults: {
        backend: "hermes" as BackendType,
      },
    });
  } catch (error) {
    return json(res, { error: String(error) }, 500);
  }
}

// POST /api/launch
async function handleLaunch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const data = JSON.parse(body);

    const { workflowId, taskTitle, backend, notifyUrl, context } = data;

    // Validation
    if (!workflowId || typeof workflowId !== "string") {
      return json(res, { error: "Missing or invalid workflowId" }, 400);
    }

    if (!taskTitle || typeof taskTitle !== "string") {
      return json(res, { error: "Missing or invalid taskTitle" }, 400);
    }

    // Validate backend if provided
    const validBackends: BackendType[] = ["hermes", "claude-code", "codex", "openclaw"];
    const selectedBackend: BackendType | undefined = backend && validBackends.includes(backend)
      ? backend
      : undefined;

    const result = await runWorkflow({
      workflowId,
      taskTitle,
      backend: selectedBackend,
      notifyUrl,
    });

    return json(res, {
      success: true,
      run: {
        id: result.id,
        runNumber: result.runNumber,
        workflowId: result.workflowId,
        task: result.task,
        status: result.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(res, { error: message }, 500);
  }
}

// POST /api/launch/validate
async function handleValidate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const data = JSON.parse(body);

    const { workflowId, taskTitle, backend } = data;
    const errors: string[] = [];

    if (!workflowId || typeof workflowId !== "string") {
      errors.push("Missing or invalid workflowId");
    }

    if (!taskTitle || typeof taskTitle !== "string") {
      errors.push("Missing or invalid taskTitle");
    }

    const validBackends: BackendType[] = ["hermes", "claude-code", "codex", "openclaw"];
    if (backend && !validBackends.includes(backend)) {
      errors.push(`Invalid backend: ${backend}`);
    }

    // Check if workflow exists
    if (workflowId) {
      const workflows = loadWorkflows();
      const exists = workflows.some((w) => w.id === workflowId);
      if (!exists) {
        errors.push(`Workflow not found: ${workflowId}`);
      }
    }

    return json(res, {
      valid: errors.length === 0,
      errors,
    });
  } catch (error) {
    return json(res, { error: String(error) }, 500);
  }
}

export function handle(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const pathname = url.pathname;
  const method = req.method || "GET";

  // Route: /api/launch/config
  if (pathname === "/api/launch/config" || pathname.endsWith("/config")) {
    if (method === "GET") {
      return void handleGetConfig(req, res);
    }
    return json(res, { error: "Method not allowed" }, 405);
  }

  // Route: /api/launch/validate
  if (pathname.includes("/validate")) {
    if (method === "POST") {
      return void handleValidate(req, res);
    }
    return json(res, { error: "Method not allowed" }, 405);
  }

  // Route: /api/launch (main launch endpoint)
  if (method === "POST") {
    return void handleLaunch(req, res);
  }

  return json(res, { error: "Not found" }, 404);
}

export function handleConfig(req: IncomingMessage, res: ServerResponse): void {
  const method = req.method || "GET";

  if (method !== "GET") {
    return json(res, { error: "Method not allowed" }, 405);
  }

  return void handleGetConfig(req, res);
}
