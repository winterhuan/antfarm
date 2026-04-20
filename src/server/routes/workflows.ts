import type { IncomingMessage, ServerResponse } from "node:http";
import type { URL } from "node:url";
import { getDb } from "../../db.js";
import { getRunEvents } from "../../installer/events.js";
import { resolveBundledWorkflowsDir } from "../../installer/paths.js";
import YAML from "yaml";
import fs from "node:fs";
import path from "node:path";

interface WorkflowDef {
  id: string;
  name: string;
  steps: Array<{ id: string; agent: string }>;
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
        steps: (parsed.steps ?? []).map((s: any) => ({ id: s.id, agent: s.agent })),
      });
    }
  } catch { /* empty */ }
  return results;
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

export function handle(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const pathname = url.pathname;

  if (pathname === "/api/workflows") {
    return json(res, loadWorkflows());
  }

  if (pathname === "/api/runs") {
    const wf = url.searchParams.get("workflow") ?? undefined;
    const db = getDb();
    const runs = wf
      ? db.prepare("SELECT * FROM runs WHERE workflow_id = ? ORDER BY created_at DESC").all(wf)
      : db.prepare("SELECT * FROM runs ORDER BY created_at DESC").all();
    return json(res, runs);
  }

  const eventsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (eventsMatch) {
    return json(res, getRunEvents(eventsMatch[1]));
  }

  const storiesMatch = pathname.match(/^\/api\/runs\/([^/]+)\/stories$/);
  if (storiesMatch) {
    const db = getDb();
    const stories = db.prepare(
      "SELECT * FROM stories WHERE run_id = ? ORDER BY story_index ASC"
    ).all(storiesMatch[1]);
    return json(res, stories);
  }

  const runMatch = pathname.match(/^\/api\/runs\/(.+)$/);
  if (runMatch) {
    const db = getDb();
    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runMatch[1]);
    if (!run) return json(res, { error: "not found" }, 404);
    const steps = db.prepare("SELECT * FROM steps WHERE run_id = ? ORDER BY step_index ASC").all(run.id);
    return json(res, { ...run, steps });
  }

  json(res, { error: "not found" }, 404);
}
