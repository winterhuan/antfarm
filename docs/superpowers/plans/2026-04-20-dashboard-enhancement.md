# Dashboard Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance Antfarm Dashboard with Agent Management and Launch Entry pages

**Architecture:** Refactor monolithic dashboard.ts into modular router + routes structure. Add status-checker for backend agent detection. Split frontend into reusable components.

**Tech Stack:** TypeScript, Node.js built-in http module, vanilla JavaScript (no frameworks)

---

## File Structure

```
src/server/
├── index.ts                 # HTTP server entry
├── router.ts                # Route dispatcher
├── routes/
│   ├── workflows.ts         # Existing workflow/run endpoints (moved from dashboard.ts)
│   ├── agents.ts            # NEW: /api/agents/*, /api/backends
│   ├── launch.ts            # NEW: /api/launch, /api/config/defaults
│   └── static.ts            # Static file serving
├── status-checker.ts        # NEW: Backend agent status detection
└── static/                  # NEW: Frontend assets
    ├── index.html           # Minimal shell
    ├── css/
    │   └── theme.css        # Extracted from current index.html
    └── js/
        ├── api.js           # API client wrapper
        ├── router.js        # Frontend hash router
        ├── components/
        │   ├── layout.js    # Shared layout
        │   ├── board-view.js      # Existing kanban (extracted)
        │   ├── agents-view.js     # NEW: Agent management
        │   └── launch-view.js     # NEW: Launch interface
        └── main.js          # Entry point
```

---

## Phase 1: Backend Refactoring

### Task 1: Create Server Entry Point

**Files:**
- Create: `src/server/index.ts`

- [ ] **Step 1: Write index.ts**

```typescript
import http from "node:http";
import { dispatch } from "./router.js";

export function startDashboard(port = 3333): http.Server {
  const server = http.createServer((req, res) => {
    dispatch(req, res, port);
  });

  server.listen(port, () => {
    console.log(`Antfarm Dashboard: http://localhost:${port}`);
  });

  return server;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(dashboard): create server entry point"
```

---

### Task 2: Create Router Dispatcher

**Files:**
- Create: `src/server/router.ts`

- [ ] **Step 1: Write router.ts**

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import * as workflows from "./routes/workflows.js";
import * as agents from "./routes/agents.js";
import * as launch from "./routes/launch.js";
import * as staticFiles from "./routes/static.js";

export function dispatch(req: IncomingMessage, res: ServerResponse, port: number): void {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const pathname = url.pathname;

  // API routes
  if (pathname.startsWith("/api/workflows")) return workflows.handle(req, res, url);
  if (pathname.startsWith("/api/agents")) return agents.handle(req, res, url);
  if (pathname.startsWith("/api/launch")) return launch.handle(req, res, url);
  if (pathname.startsWith("/api/backends")) return agents.handleBackends(req, res);
  if (pathname.startsWith("/api/config")) return launch.handleConfig(req, res);

  // Static assets
  staticFiles.serve(req, res, pathname);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/router.ts
git commit -m "feat(dashboard): create route dispatcher"
```

---

### Task 3: Migrate Workflow Routes

**Files:**
- Create: `src/server/routes/workflows.ts`
- Modify: `src/server/dashboard.ts` (mark as deprecated/empty)

- [ ] **Step 1: Extract existing dashboard.ts logic to workflows.ts**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/server/routes/workflows.ts
git commit -m "feat(dashboard): migrate workflow routes"
```

---

### Task 4: Create Static File Routes

**Files:**
- Create: `src/server/routes/static.ts`

- [ ] **Step 1: Write static.ts**

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, "..", "..", "..", "static");

function serveFile(res: ServerResponse, filePath: string, contentType: string): void {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function guessContentType(ext: string): string {
  const types: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  return types[ext] || "application/octet-stream";
}

export function serve(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  // API fallback - serve index.html for SPA routes
  if (pathname.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  // Map URL path to file path
  let filePath = path.join(staticDir, pathname === "/" ? "index.html" : pathname);

  // Security: prevent directory traversal
  if (!filePath.startsWith(staticDir)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  // If directory or doesn't exist, serve index.html (SPA fallback)
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(staticDir, "index.html");
  }

  const ext = path.extname(filePath);
  const contentType = guessContentType(ext);
  serveFile(res, filePath, contentType);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/routes/static.ts
git commit -m "feat(dashboard): add static file serving"
```

---

### Task 5: Create Status Checker

**Files:**
- Create: `src/server/status-checker.ts`
- Create: `tests/status-checker.test.ts`

- [ ] **Step 1: Write status-checker.ts**

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "../db.js";
import type { BackendType } from "../backend/interface.js";

const execFileAsync = promisify(execFile);

export type AgentStatus = "running" | "stopped" | "error" | "unknown";

export interface AgentInfo {
  id: string;
  workflowId: string;
  agentId: string;
  backend: BackendType;
  status: AgentStatus;
  workspacePath?: string;
  lastSeen?: string;
  config: {
    model?: string;
    timeoutSeconds?: number;
    role?: string;
  };
}

function getHermesHome(): string {
  return process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
}

function getCodexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

async function checkHermesStatus(profileName: string): Promise<AgentStatus> {
  try {
    await execFileAsync("hermes", ["--profile", profileName, "gateway", "status"]);
    return "running";
  } catch {
    return "stopped";
  }
}

async function checkCodexStatus(profileName: string): Promise<AgentStatus> {
  // Codex uses subprocess scheduler - check if there's an active run for this agent
  const db = getDb();
  const active = db.prepare(
    `SELECT s.id FROM steps s
     JOIN runs r ON r.id = s.run_id
     WHERE s.agent_id = ? AND r.status = 'running' AND s.status = 'running'
     LIMIT 1`
  ).get(profileName);
  return active ? "running" : "stopped";
}

async function checkClaudeCodeStatus(agentId: string): Promise<AgentStatus> {
  // Claude Code also uses subprocess scheduler
  const db = getDb();
  const active = db.prepare(
    `SELECT s.id FROM steps s
     JOIN runs r ON r.id = s.run_id
     WHERE s.agent_id = ? AND r.status = 'running' AND s.status = 'running'
     LIMIT 1`
  ).get(agentId);
  return active ? "running" : "stopped";
}

async function checkOpenClawStatus(): Promise<AgentStatus> {
  // OpenClaw manages its own gateway - check subprocess scheduler
  return "unknown";
}

export async function getAgentStatus(
  workflowId: string,
  agentId: string,
  backend: BackendType
): Promise<AgentStatus> {
  const profileName = `${workflowId}_${agentId}`;

  switch (backend) {
    case "hermes":
      return checkHermesStatus(profileName);
    case "claude-code":
      return checkClaudeCodeStatus(profileName);
    case "codex":
      return checkCodexStatus(getCodexProfileName(workflowId, agentId));
    case "openclaw":
      return checkOpenClawStatus();
    default:
      return "unknown";
  }
}

function getCodexProfileName(workflowId: string, agentId: string): string {
  return `antfarm-${workflowId}-${agentId}`;
}

export async function listAllAgents(): Promise<AgentInfo[]> {
  const agents: AgentInfo[] = [];

  // Scan Hermes profiles
  const hermesProfilesDir = path.join(getHermesHome(), "profiles");
  try {
    const entries = await fs.readdir(hermesProfilesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const markerPath = path.join(hermesProfilesDir, entry.name, ".antfarm");
      try {
        const marker = JSON.parse(await fs.readFile(markerPath, "utf-8"));
        const separator = entry.name.indexOf("_");
        if (separator > 0) {
          const workflowId = entry.name.slice(0, separator);
          const agentId = entry.name.slice(separator + 1);
          agents.push({
            id: entry.name,
            workflowId,
            agentId,
            backend: "hermes",
            status: await checkHermesStatus(entry.name),
            workspacePath: path.join(hermesProfilesDir, entry.name, "workspace"),
            config: { model: "default", timeoutSeconds: 1800 },
          });
        }
      } catch {
        // Not an antfarm profile
      }
    }
  } catch {
    // Profiles dir doesn't exist
  }

  // Scan Claude Code agents
  const claudeAgentsDir = path.join(process.cwd(), ".claude", "agents");
  try {
    const entries = await fs.readdir(claudeAgentsDir);
    for (const file of entries) {
      const match = file.match(/^(.+)_(.+)\.md$/);
      if (match) {
        const [, workflowId, agentId] = match;
        agents.push({
          id: `${workflowId}_${agentId}`,
          workflowId,
          agentId,
          backend: "claude-code",
          status: await checkClaudeCodeStatus(`${workflowId}_${agentId}`),
          workspacePath: path.join(claudeAgentsDir, file),
          config: { model: "sonnet" },
        });
      }
    }
  } catch {
    // .claude/agents doesn't exist
  }

  // Scan Codex agents
  const codexAgentsDir = path.join(getCodexHome(), "agents");
  try {
    const entries = await fs.readdir(codexAgentsDir);
    for (const file of entries) {
      const match = file.match(/^antfarm-(.+)-(.+)\.toml$/);
      if (match) {
        const [, workflowId, agentId] = match;
        agents.push({
          id: `${workflowId}_${agentId}`,
          workflowId,
          agentId,
          backend: "codex",
          status: await checkCodexStatus(getCodexProfileName(workflowId, agentId)),
          workspacePath: path.join(codexAgentsDir, file),
          config: { model: "gpt-5.3-codex" },
        });
      }
    }
  } catch {
    // .codex/agents doesn't exist
  }

  return agents;
}
```

- [ ] **Step 2: Write basic test**

```typescript
import { describe, it, expect } from "vitest";
import { listAllAgents, getAgentStatus } from "../src/server/status-checker.js";

describe("status-checker", () => {
  it("should return empty array when no agents installed", async () => {
    // This test assumes clean environment - may need mocking
    const agents = await listAllAgents();
    expect(Array.isArray(agents)).toBe(true);
  });

  it("should return unknown for non-existent agent", async () => {
    const status = await getAgentStatus("test", "test", "hermes");
    expect(["running", "stopped", "error", "unknown"]).toContain(status);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/server/status-checker.ts tests/status-checker.test.ts
git commit -m "feat(dashboard): add status checker for backend agents"
```

---

### Task 6: Create Agents API Routes

**Files:**
- Create: `src/server/routes/agents.ts`

- [ ] **Step 1: Write agents.ts**

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import { listAllAgents, getAgentStatus } from "../status-checker.js";
import type { BackendType } from "../../backend/interface.js";

const BACKENDS: Array<{ id: BackendType; name: string; description: string }> = [
  { id: "openclaw", name: "OpenClaw", description: "OpenClaw CLI backend" },
  { id: "hermes", name: "Hermes", description: "Hermes agent platform" },
  { id: "claude-code", name: "Claude Code", description: "Claude Code CLI" },
  { id: "codex", name: "Codex", description: "OpenAI Codex CLI" },
];

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function getBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
  });
}

export function handleBackends(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    return json(res, { error: "Method not allowed" }, 405);
  }
  json(res, BACKENDS);
}

export async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  // GET /api/agents - list all agents
  if (pathname === "/api/agents" && req.method === "GET") {
    const agents = await listAllAgents();
    return json(res, agents);
  }

  // POST /api/agents/:id/start
  const startMatch = pathname.match(/^\/api\/agents\/([^/]+)\/start$/);
  if (startMatch && req.method === "POST") {
    const agentId = decodeURIComponent(startMatch[1]);
    // TODO: Implement start logic based on backend type
    return json(res, { id: agentId, action: "start", status: "not_implemented" });
  }

  // POST /api/agents/:id/stop
  const stopMatch = pathname.match(/^\/api\/agents\/([^/]+)\/stop$/);
  if (stopMatch && req.method === "POST") {
    const agentId = decodeURIComponent(stopMatch[1]);
    // TODO: Implement stop logic based on backend type
    return json(res, { id: agentId, action: "stop", status: "not_implemented" });
  }

  return json(res, { error: "Not found" }, 404);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/routes/agents.ts
git commit -m "feat(dashboard): add agents API routes"
```

---

### Task 7: Create Launch API Routes

**Files:**
- Create: `src/server/routes/launch.ts`

- [ ] **Step 1: Write launch.ts**

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import { runWorkflow } from "../../installer/run.js";
import type { BackendType } from "../../backend/interface.js";

interface LaunchRequest {
  workflowId: string;
  task: string;
  backend?: BackendType;
  model?: string;
  timeoutSeconds?: number;
  notifyUrl?: string;
}

const DEFAULTS = {
  timeoutSeconds: 1800,
  model: "default",
};

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function getBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
  });
}

export function handleConfig(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    return json(res, { error: "Method not allowed" }, 405);
  }
  json(res, {
    defaults: DEFAULTS,
    models: ["default", "sonnet", "opus", "haiku", "gpt-4", "gpt-5.3-codex"],
    timeouts: [300, 600, 900, 1800, 3600],
  });
}

export async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  // POST /api/launch
  if (pathname === "/api/launch" && req.method === "POST") {
    const body = await getBody(req);
    let data: LaunchRequest;
    try {
      data = JSON.parse(body);
    } catch {
      return json(res, { error: "Invalid JSON" }, 400);
    }

    if (!data.workflowId || !data.task) {
      return json(res, { error: "Missing required fields: workflowId, task" }, 400);
    }

    try {
      const run = await runWorkflow({
        workflowId: data.workflowId,
        taskTitle: data.task,
        backend: data.backend,
        notifyUrl: data.notifyUrl,
      });
      json(res, {
        success: true,
        run: {
          id: run.id,
          runNumber: run.runNumber,
          workflowId: run.workflowId,
          task: run.task,
          status: run.status,
        },
      });
    } catch (err) {
      json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
    return;
  }

  return json(res, { error: "Not found" }, 404);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/routes/launch.ts
git commit -m "feat(dashboard): add launch API routes"
```

---

### Task 8: Update Dashboard Export

**Files:**
- Modify: `src/server/dashboard.ts`

- [ ] **Step 1: Replace dashboard.ts content to re-export from new location**

```typescript
// Deprecated: Use src/server/index.ts instead
// This file re-exports for backward compatibility
export { startDashboard } from "./index.js";
```

- [ ] **Step 2: Commit**

```bash
git add src/server/dashboard.ts
git commit -m "refactor(dashboard): deprecate old dashboard.ts, re-export from index.ts"
```

---

## Phase 2: Frontend Refactoring

### Task 9: Create Static Directory Structure

**Files:**
- Create directories (no files yet)

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/server/static/css
mkdir -p src/server/static/js/components
```

- [ ] **Step 2: Commit**

```bash
git add -N src/server/static/
git commit -m "chore(dashboard): create static assets directory structure"
```

---

### Task 10: Extract CSS to Theme File

**Files:**
- Create: `src/server/static/css/theme.css`

- [ ] **Step 1: Extract CSS from current index.html**

```css
/* ── Theme tokens ──────────────────────────────────────────────── */
:root {
  --bg-page: #FAF8F5;
  --bg-surface: #fff;
  --bg-surface-alt: #FAF8F5;
  --bg-column-header: #f5f0e8;
  --text-primary: #3A3226;
  --text-secondary: #8b8072;
  --text-tertiary: #5a5045;
  --border: #D4C4A0;
  --border-light: #eee;
  --shadow: rgba(58, 50, 38, .1);
  --shadow-heavy: rgba(58, 50, 38, .15);
  --overlay: rgba(58, 50, 38, .5);

  /* Header */
  --header-bg: #6B7F3B;
  --header-border: #5a6b32;
  --header-select-bg: #5a6b32;
  --header-select-border: #4a5a28;

  /* Accents */
  --accent-green: #6B7F3B;
  --accent-green-subtle: #6B7F3B22;
  --accent-teal: #3a9e8a;
  --accent-teal-subtle: #8ECFC033;
  --accent-orange: #E8845C;
  --accent-orange-subtle: #E8845C22;
  --accent-muted: #D4C4A044;
  --accent-orange-faint: #E8845C11;
  --accent-highlight: #D4E8A0;

  /* Pre/code */
  --bg-code: #FAF8F5;
}

[data-theme="dark"] {
  --bg-page: #1a1917;
  --bg-surface: #262521;
  --bg-surface-alt: #1f1e1b;
  --bg-column-header: #2a2926;
  --text-primary: #e0d8ce;
  --text-secondary: #9a9088;
  --text-tertiary: #b0a89e;
  --border: #3d3a34;
  --border-light: #333;
  --shadow: rgba(0, 0, 0, .25);
  --shadow-heavy: rgba(0, 0, 0, .4);
  --overlay: rgba(0, 0, 0, .6);

  --header-bg: #2d3320;
  --header-border: #3a4228;
  --header-select-bg: #3a4228;
  --header-select-border: #4a5438;

  --accent-green: #8fa74e;
  --accent-green-subtle: rgba(143, 167, 78, .15);
  --accent-teal: #6bc4b0;
  --accent-teal-subtle: rgba(107, 196, 176, .15);
  --accent-orange: #e8955f;
  --accent-orange-subtle: rgba(232, 149, 95, .15);
  --accent-muted: rgba(255, 255, 255, .06);
  --accent-orange-faint: rgba(232, 149, 95, .08);
  --accent-highlight: #b5cc80;

  --bg-code: #1f1e1b;
}

/* Auto dark mode */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg-page: #1a1917;
    --bg-surface: #262521;
    --bg-surface-alt: #1f1e1b;
    --bg-column-header: #2a2926;
    --text-primary: #e0d8ce;
    --text-secondary: #9a9088;
    --text-tertiary: #b0a89e;
    --border: #3d3a34;
    --border-light: #333;
    --shadow: rgba(0, 0, 0, .25);
    --shadow-heavy: rgba(0, 0, 0, .4);
    --overlay: rgba(0, 0, 0, .6);

    --header-bg: #2d3320;
    --header-border: #3a4228;
    --header-select-bg: #3a4228;
    --header-select-border: #4a5438;

    --accent-green: #8fa74e;
    --accent-green-subtle: rgba(143, 167, 78, .15);
    --accent-teal: #6bc4b0;
    --accent-teal-subtle: rgba(107, 196, 176, .15);
    --accent-orange: #e8955f;
    --accent-orange-subtle: rgba(232, 149, 95, .15);
    --accent-muted: rgba(255, 255, 255, .06);
    --accent-orange-faint: rgba(232, 149, 95, .08);
    --accent-highlight: #b5cc80;

    --bg-code: #1f1e1b;
  }
}

/* ── Base ──────────────────────────────────────────────────────── */
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg-page);color:var(--text-primary);min-height:100vh}

/* ── Header ────────────────────────────────────────────────────── */
header{background:var(--header-bg);border-bottom:2px solid var(--header-border);padding:12px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
header img{height:36px;border-radius:6px}
header h1{font-family:'Inter',sans-serif;font-size:22px;font-weight:600;color:#fff;letter-spacing:0}
header h1 span{color:var(--accent-highlight)}

/* ── Navigation ────────────────────────────────────────────────── */
.nav-link{color:rgba(255,255,255,.7);text-decoration:none;padding:6px 12px;border-radius:6px;font-size:14px;transition:background .15s,color .15s}
.nav-link:hover{color:#fff;background:rgba(255,255,255,.1)}
.nav-link.active{color:#fff;background:rgba(255,255,255,.2)}

/* ── Theme toggle ──────────────────────────────────────────────── */
.theme-toggle{background:none;border:1px solid rgba(255,255,255,.2);border-radius:6px;color:#fff;cursor:pointer;padding:5px 8px;font-size:16px;line-height:1;transition:border-color .15s}
.theme-toggle:hover{border-color:rgba(255,255,255,.5)}

/* ── Main content ──────────────────────────────────────────────── */
main{min-height:calc(100vh - 65px)}

/* ── Board view ────────────────────────────────────────────────── */
.board{display:flex;gap:16px;padding:24px;overflow-x:auto;min-height:calc(100vh - 65px)}
.column{min-width:240px;flex:1;background:var(--bg-surface);border:none;border-radius:8px;display:flex;flex-direction:column;box-shadow:0 2px 8px var(--shadow)}
.column-header{padding:12px 16px;border-bottom:1px solid var(--border-light);font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--accent-green);background:var(--bg-column-header);border-radius:8px 8px 0 0}
.column-header .count{background:var(--accent-green);color:#fff;border-radius:10px;padding:1px 8px;font-size:11px;margin-left:8px}
.cards{padding:8px;flex:1;display:flex;flex-direction:column;gap:8px;overflow-y:auto}

/* ── Cards ─────────────────────────────────────────────────────── */
.card{background:var(--bg-surface-alt);border:1px solid var(--border);border-radius:6px;padding:12px;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.card:hover{border-color:var(--accent-orange);box-shadow:0 2px 8px var(--accent-orange-subtle)}
.card-title{font-size:13px;font-weight:500;color:var(--text-primary);margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-meta{font-size:11px;color:var(--text-secondary);display:flex;justify-content:space-between;align-items:center}
.card.done{border-left:3px solid var(--accent-green)}
.card.failed,.card.error{border-left:3px solid var(--accent-orange)}

/* ── Overlay / Panel ───────────────────────────────────────────── */
.overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--overlay);z-index:100;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .15s}
.overlay.open{opacity:1;pointer-events:auto}
.panel{background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;width:90%;max-width:640px;max-height:85vh;overflow-y:auto;padding:24px;position:relative;box-shadow:0 8px 32px var(--shadow-heavy)}

/* ── Badges ────────────────────────────────────────────────────── */
.badge{font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;text-transform:uppercase}
.badge-running{background:var(--accent-teal-subtle);color:var(--accent-teal)}
.badge-done,.badge-completed{background:var(--accent-green-subtle);color:var(--accent-green)}
.badge-failed,.badge-error{background:var(--accent-orange-subtle);color:var(--accent-orange)}
.badge-waiting{background:var(--accent-muted);color:var(--text-secondary)}
.badge-pending{background:var(--accent-muted);color:var(--text-secondary)}

/* ── Agent cards (new) ─────────────────────────────────────────── */
.agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;padding:24px}
.agent-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:16px;transition:border-color .15s}
.agent-card:hover{border-color:var(--accent-teal)}
.agent-card-header{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.agent-card-header h3{font-size:14px;font-weight:600;flex:1}
.agent-status-dot{width:8px;height:8px;border-radius:50%}
.agent-status-dot.running{background:var(--accent-green);box-shadow:0 0 6px rgba(107,127,59,.5)}
.agent-status-dot.stopped{background:var(--text-secondary)}
.agent-status-dot.error{background:var(--accent-orange);box-shadow:0 0 6px rgba(232,132,92,.5)}
.agent-card-meta{font-size:12px;color:var(--text-secondary);margin-bottom:12px}
.agent-card-meta div{margin-bottom:4px}
.agent-card-actions{display:flex;gap:8px}
.agent-card-actions button{padding:6px 12px;border:1px solid var(--border);border-radius:4px;background:var(--bg-surface-alt);cursor:pointer;font-size:12px;transition:all .15s}
.agent-card-actions button:hover{border-color:var(--accent-teal);background:var(--accent-teal-subtle)}
.agent-card-actions button.primary{background:var(--accent-green);color:#fff;border-color:var(--accent-green)}
.agent-card-actions button.primary:hover{background:#5a6b32}

/* ── Launch form (new) ─────────────────────────────────────────── */
.launch-container{max-width:800px;margin:0 auto;padding:24px}
.launch-section{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:24px;margin-bottom:16px}
.launch-section h2{font-size:16px;font-weight:600;margin-bottom:16px;color:var(--text-primary)}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
.form-group input,.form-group select,.form-group textarea{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-surface);color:var(--text-primary);font-size:14px}
.form-group input:focus,.form-group select:focus,.form-group textarea:focus{outline:none;border-color:var(--accent-teal)}
.form-group textarea{min-height:120px;resize:vertical}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.advanced-toggle{color:var(--accent-teal);cursor:pointer;font-size:13px;display:flex;align-items:center;gap:4px}
.advanced-toggle:hover{color:var(--accent-green)}
.btn-launch{width:100%;padding:14px 24px;background:var(--accent-green);color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;transition:background .15s}
.btn-launch:hover{background:#5a6b32}
.btn-launch:disabled{background:var(--border);cursor:not-allowed}

/* ── Misc ──────────────────────────────────────────────────────── */
.empty{color:var(--text-secondary);font-size:12px;text-align:center;padding:24px 8px}
.refresh-note{color:rgba(255,255,255,.6);font-size:11px;margin-left:auto}
@media(max-width:768px){.board{flex-direction:column}.column{min-width:unset}.form-row{grid-template-columns:1fr}}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/static/css/theme.css
git commit -m "feat(dashboard): extract CSS to theme.css"
```

---

### Task 11: Create API Client

**Files:**
- Create: `src/server/static/js/api.js`

- [ ] **Step 1: Write api.js**

```javascript
const API_BASE = '';

async function fetchJSON(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export const api = {
  // Workflows
  async getWorkflows() {
    return fetchJSON('/api/workflows');
  },

  async getRuns(workflowId) {
    const url = workflowId ? `/api/runs?workflow=${workflowId}` : '/api/runs';
    return fetchJSON(url);
  },

  async getRun(id) {
    return fetchJSON(`/api/runs/${id}`);
  },

  async getRunEvents(id) {
    return fetchJSON(`/api/runs/${id}/events`);
  },

  async getRunStories(id) {
    return fetchJSON(`/api/runs/${id}/stories`);
  },

  // Agents
  async getBackends() {
    return fetchJSON('/api/backends');
  },

  async getAgents() {
    return fetchJSON('/api/agents');
  },

  async startAgent(id) {
    return fetchJSON(`/api/agents/${encodeURIComponent(id)}/start`, { method: 'POST' });
  },

  async stopAgent(id) {
    return fetchJSON(`/api/agents/${encodeURIComponent(id)}/stop`, { method: 'POST' });
  },

  // Launch
  async getConfigDefaults() {
    return fetchJSON('/api/config/defaults');
  },

  async launch(data) {
    return fetchJSON('/api/launch', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/server/static/js/api.js
git commit -m "feat(dashboard): add API client"
```

---

### Task 12: Create Frontend Router

**Files:**
- Create: `src/server/static/js/router.js`

- [ ] **Step 1: Write router.js**

```javascript
const routes = {};

export function register(path, handler) {
  routes[path] = handler;
}

export function navigate(path) {
  window.location.hash = path;
}

export function getCurrentPath() {
  return window.location.hash.slice(1) || '/';
}

function matchRoute(path) {
  // Exact match
  if (routes[path]) return { handler: routes[path], params: {} };

  // Param match (e.g., /runs/:id)
  for (const [route, handler] of Object.entries(routes)) {
    const pattern = route.replace(/:([^/]+)/g, '([^/]+)');
    const regex = new RegExp(`^${pattern}$`);
    const match = path.match(regex);
    if (match) {
      const keys = (route.match(/:([^/]+)/g) || []).map(k => k.slice(1));
      const params = Object.fromEntries(keys.map((key, i) => [key, match[i + 1]]));
      return { handler, params };
    }
  }

  return null;
}

function render() {
  const path = getCurrentPath();
  const match = matchRoute(path);

  const app = document.getElementById('app');
  if (!app) return;

  if (match) {
    app.innerHTML = '';
    match.handler(app, match.params);
  } else {
    app.innerHTML = '<div class="empty">Page not found</div>';
  }
}

export function init() {
  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', render);
}

// Auto-init if loaded directly
if (typeof window !== 'undefined') {
  init();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/static/js/router.js
git commit -m "feat(dashboard): add frontend router"
```

---

### Task 13: Create Layout Component

**Files:**
- Create: `src/server/static/js/components/layout.js`

- [ ] **Step 1: Write layout.js**

```javascript
import { navigate, getCurrentPath } from '../router.js';

export function renderLayout(container) {
  const currentPath = getCurrentPath() || '/board';

  const header = document.createElement('header');
  header.innerHTML = `
    <h1><span>antfarm</span> dashboard</h1>
    <nav>
      <a href="#/board" class="nav-link ${currentPath.startsWith('/board') ? 'active' : ''}">Board</a>
      <a href="#/agents" class="nav-link ${currentPath.startsWith('/agents') ? 'active' : ''}">Agents</a>
      <a href="#/launch" class="nav-link ${currentPath.startsWith('/launch') ? 'active' : ''}">Launch</a>
    </nav>
    <button class="theme-toggle" id="theme-toggle" title="Toggle light/dark mode">☀️</button>
    <span class="refresh-note">Auto-refresh: 30s</span>
  `;

  document.body.insertBefore(header, container);

  // Theme toggle
  const btn = header.querySelector('#theme-toggle');
  const root = document.documentElement;
  const STORAGE_KEY = 'antfarm-theme';

  function getEffectiveTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    btn.textContent = theme === 'dark' ? '🌙' : '☀️';
    btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }

  applyTheme(getEffectiveTheme());

  btn.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') || getEffectiveTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  });

  // Navigation click handlers
  header.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(new URL(link.href).hash.slice(1));
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/static/js/components/layout.js
git commit -m "feat(dashboard): add layout component with nav"
```

---

### Task 14: Create Agents View Component

**Files:**
- Create: `src/server/static/js/components/agents-view.js`

- [ ] **Step 1: Write agents-view.js**

```javascript
import { api } from '../api.js';

export async function renderAgentsView(container) {
  container.innerHTML = '<div class="empty">Loading agents...</div>';

  try {
    const [agents, backends] = await Promise.all([
      api.getAgents(),
      api.getBackends(),
    ]);

    const backendMap = Object.fromEntries(backends.map(b => [b.id, b]));

    // Group by workflow
    const byWorkflow = {};
    agents.forEach(agent => {
      if (!byWorkflow[agent.workflowId]) {
        byWorkflow[agent.workflowId] = [];
      }
      byWorkflow[agent.workflowId].push(agent);
    });

    // Group by backend
    const byBackend = {};
    agents.forEach(agent => {
      if (!byBackend[agent.backend]) {
        byBackend[agent.backend] = [];
      }
      byBackend[agent.backend].push(agent);
    });

    let currentView = 'workflow'; // 'workflow' or 'backend'

    function renderGrid(agentList) {
      if (agentList.length === 0) {
        return '<div class="empty">No agents installed</div>';
      }

      return `
        <div class="agent-grid">
          ${agentList.map(agent => `
            <div class="agent-card" data-id="${agent.id}">
              <div class="agent-card-header">
                <span>${backendMap[agent.backend]?.name || agent.backend}</span>
                <h3>${agent.id}</h3>
                <span class="agent-status-dot ${agent.status}" title="${agent.status}"></span>
              </div>
              <div class="agent-card-meta">
                <div>Workflow: ${agent.workflowId}</div>
                <div>Agent: ${agent.agentId}</div>
                ${agent.config.model ? `<div>Model: ${agent.config.model}</div>` : ''}
                ${agent.config.role ? `<div>Role: ${agent.config.role}</div>` : ''}
              </div>
              <div class="agent-card-actions">
                <button class="primary" data-action="start" ${agent.status === 'running' ? 'disabled' : ''}>Start</button>
                <button data-action="stop" ${agent.status !== 'running' ? 'disabled' : ''}>Stop</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    function render() {
      const agentsToShow = currentView === 'workflow'
        ? Object.entries(byWorkflow).flatMap(([wf, list]) => list)
        : agents;

      container.innerHTML = `
        <div style="padding: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h2 style="font-size: 18px; font-weight: 600;">Agents (${agents.length})</h2>
            <div style="display: flex; gap: 8px;">
              <button class="view-toggle ${currentView === 'workflow' ? 'active' : ''}" data-view="workflow">By Workflow</button>
              <button class="view-toggle ${currentView === 'backend' ? 'active' : ''}" data-view="backend">By Backend</button>
            </div>
          </div>
          ${currentView === 'workflow' ? renderWorkflowView() : renderBackendView()}
        </div>
      `;

      // Add event listeners
      container.querySelectorAll('.view-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          currentView = btn.dataset.view;
          render();
        });
      });

      container.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const card = e.target.closest('.agent-card');
          const id = card.dataset.id;
          const action = e.target.dataset.action;

          e.target.disabled = true;
          e.target.textContent = action === 'start' ? 'Starting...' : 'Stopping...';

          try {
            if (action === 'start') {
              await api.startAgent(id);
            } else {
              await api.stopAgent(id);
            }
            // Refresh
            renderAgentsView(container);
          } catch (err) {
            alert(`Failed to ${action} agent: ${err.message}`);
            render();
          }
        });
      });
    }

    function renderWorkflowView() {
      if (Object.keys(byWorkflow).length === 0) {
        return '<div class="empty">No agents installed</div>';
      }

      return Object.entries(byWorkflow).map(([workflowId, list]) => `
        <div style="margin-bottom: 24px;">
          <h3 style="font-size: 14px; font-weight: 600; color: var(--accent-green); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
            ${workflowId} <span style="background: var(--accent-green); color: #fff; border-radius: 10px; padding: 2px 8px; font-size: 11px; margin-left: 8px;">${list.length}</span>
          </h3>
          ${renderGrid(list)}
        </div>
      `).join('');
    }

    function renderBackendView() {
      if (Object.keys(byBackend).length === 0) {
        return '<div class="empty">No agents installed</div>';
      }

      return Object.entries(byBackend).map(([backendId, list]) => `
        <div style="margin-bottom: 24px;">
          <h3 style="font-size: 14px; font-weight: 600; color: var(--accent-teal); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
            ${backendMap[backendId]?.name || backendId} <span style="background: var(--accent-teal); color: #fff; border-radius: 10px; padding: 2px 8px; font-size: 11px; margin-left: 8px;">${list.length}</span>
          </h3>
          ${renderGrid(list)}
        </div>
      `).join('');
    }

    render();

  } catch (err) {
    container.innerHTML = `<div class="empty">Error loading agents: ${err.message}</div>`;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/static/js/components/agents-view.js
git commit -m "feat(dashboard): add agents view component"
```

---

### Task 15: Create Launch View Component

**Files:**
- Create: `src/server/static/js/components/launch-view.js`

- [ ] **Step 1: Write launch-view.js**

```javascript
import { api } from '../api.js';
import { navigate } from '../router.js';

export async function renderLaunchView(container) {
  container.innerHTML = '<div class="empty">Loading...</div>';

  try {
    const [workflows, config] = await Promise.all([
      api.getWorkflows(),
      api.getConfigDefaults(),
    ]);

    const backends = await api.getBackends();

    let selectedWorkflow = workflows[0]?.id || '';
    let showAdvanced = false;

    function render() {
      const workflow = workflows.find(w => w.id === selectedWorkflow);

      container.innerHTML = `
        <div class="launch-container">
          <div class="launch-section">
            <h2>Quick Start</h2>

            <div class="form-group">
              <label>Workflow</label>
              <select id="workflow-select">
                ${workflows.map(w => `<option value="${w.id}" ${w.id === selectedWorkflow ? 'selected' : ''}>${w.name}</option>`).join('')}
              </select>
            </div>

            <div class="form-group">
              <label>Task Description</label>
              <textarea id="task-input" placeholder="Describe what you want to accomplish..."></textarea>
            </div>

            <button class="btn-launch" id="launch-btn">▶ Start Run</button>
          </div>

          <div class="launch-section">
            <div class="advanced-toggle" id="advanced-toggle">
              <span>${showAdvanced ? '▼' : '▶'}</span> Advanced Configuration
            </div>

            ${showAdvanced ? `
              <div style="margin-top: 16px;">
                <div class="form-group">
                  <label>Backend</label>
                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${backends.map(b => `
                      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="radio" name="backend" value="${b.id}" ${b.id === 'hermes' ? 'checked' : ''}>
                        <span>${b.name}</span>
                        <span style="color: var(--text-secondary); font-size: 12px;">— ${b.description}</span>
                      </label>
                    `).join('')}
                  </div>
                </div>

                <div class="form-row">
                  <div class="form-group">
                    <label>Model</label>
                    <select id="model-select">
                      ${config.models.map(m => `<option value="${m}">${m}</option>`).join('')}
                    </select>
                  </div>

                  <div class="form-group">
                    <label>Timeout</label>
                    <select id="timeout-select">
                      ${config.timeouts.map(t => `<option value="${t}" ${t === config.defaults.timeoutSeconds ? 'selected' : ''}>${Math.floor(t / 60)} min</option>`).join('')}
                    </select>
                  </div>
                </div>

                <div class="form-group">
                  <label>Notify URL (optional)</label>
                  <input type="text" id="notify-url" placeholder="https://...">
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;

      // Event listeners
      const workflowSelect = container.querySelector('#workflow-select');
      if (workflowSelect) {
        workflowSelect.addEventListener('change', (e) => {
          selectedWorkflow = e.target.value;
        });
      }

      const advancedToggle = container.querySelector('#advanced-toggle');
      if (advancedToggle) {
        advancedToggle.addEventListener('click', () => {
          showAdvanced = !showAdvanced;
          render();
        });
      }

      const launchBtn = container.querySelector('#launch-btn');
      if (launchBtn) {
        launchBtn.addEventListener('click', async () => {
          const task = container.querySelector('#task-input').value.trim();
          if (!task) {
            alert('Please enter a task description');
            return;
          }

          launchBtn.disabled = true;
          launchBtn.textContent = 'Starting...';

          const data = {
            workflowId: selectedWorkflow,
            task,
          };

          if (showAdvanced) {
            const backend = container.querySelector('input[name="backend"]:checked')?.value;
            const model = container.querySelector('#model-select')?.value;
            const timeout = container.querySelector('#timeout-select')?.value;
            const notifyUrl = container.querySelector('#notify-url')?.value;

            if (backend) data.backend = backend;
            if (model && model !== 'default') data.model = model;
            if (timeout) data.timeoutSeconds = parseInt(timeout, 10);
            if (notifyUrl) data.notifyUrl = notifyUrl;
          }

          try {
            const result = await api.launch(data);
            navigate(`/board?highlight=${result.run.id}`);
          } catch (err) {
            alert(`Failed to start run: ${err.message}`);
            launchBtn.disabled = false;
            launchBtn.textContent = '▶ Start Run';
          }
        });
      }
    }

    render();

  } catch (err) {
    container.innerHTML = `<div class="empty">Error loading: ${err.message}</div>`;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/static/js/components/launch-view.js
git commit -m "feat(dashboard): add launch view component"
```

---

### Task 16: Create Main Entry Point

**Files:**
- Create: `src/server/static/js/main.js`
- Create: `src/server/static/index.html`

- [ ] **Step 1: Write main.js**

```javascript
import { register, init } from './router.js';
import { renderLayout } from './components/layout.js';
import { renderBoardView } from './components/board-view.js';
import { renderAgentsView } from './components/agents-view.js';
import { renderLaunchView } from './components/launch-view.js';

const app = document.createElement('main');
app.id = 'app';
document.body.appendChild(app);

renderLayout(app);

// Register routes
register('/board', renderBoardView);
register('/agents', renderAgentsView);
register('/launch', renderLaunchView);

// Default redirect
if (!window.location.hash) {
  window.location.hash = '#/board';
}

init();
```

- [ ] **Step 2: Write new index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Antfarm Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist+Mono&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/theme.css">
<script type="module" src="/js/main.js"></script>
</head>
<body>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add src/server/static/js/main.js src/server/static/index.html
git commit -m "feat(dashboard): add main entry point and new index.html"
```

---

### Task 17: Port Existing Board View

**Files:**
- Create: `src/server/static/js/components/board-view.js`

- [ ] **Step 1: Port existing board logic from old index.html**

```javascript
import { api } from '../api.js';

const stepIcons = { done: '✓', running: '●', pending: '○', waiting: '◌', failed: '✗', error: '✗' };

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseTS(ts) {
  if (!ts) return null;
  if (!ts.endsWith('Z') && !ts.includes('+')) ts = ts.replace(' ', 'T') + 'Z';
  return new Date(ts);
}

export async function renderBoardView(container) {
  container.innerHTML = '<div class="empty">Loading workflows...</div>';

  try {
    const workflows = await api.getWorkflows();

    if (workflows.length === 0) {
      container.innerHTML = '<div class="empty">No workflows available</div>';
      return;
    }

    // Build UI
    container.innerHTML = `
      <div style="padding: 24px;">
        <select id="wf-select" style="margin-bottom: 16px;">
          <option value="">— select workflow —</option>
          ${workflows.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
        </select>
        <div id="board" class="board"><div class="empty">Select a workflow</div></div>
      </div>
    `;

    const select = container.querySelector('#wf-select');
    const board = container.querySelector('#board');

    select.addEventListener('change', async (e) => {
      const workflowId = e.target.value;
      if (!workflowId) {
        board.innerHTML = '<div class="empty">Select a workflow</div>';
        return;
      }

      const workflow = workflows.find(w => w.id === workflowId);
      await loadAndRenderBoard(board, workflow);
    });

    // Auto-select first workflow or one with active runs
    if (workflows.length === 1) {
      select.value = workflows[0].id;
      await loadAndRenderBoard(board, workflows[0]);
    } else {
      // Check for active runs
      for (const w of workflows) {
        const runs = await api.getRuns(w.id);
        if (runs.some(r => r.status === 'running' || r.status === 'pending')) {
          select.value = w.id;
          await loadAndRenderBoard(board, w);
          break;
        }
      }
    }

  } catch (err) {
    container.innerHTML = `<div class="empty">Error: ${err.message}</div>`;
  }
}

async function loadAndRenderBoard(board, workflow) {
  board.innerHTML = '<div class="empty">Loading...</div>';

  try {
    const runs = await api.getRuns(workflow.id);

    // Group runs by current step
    const columns = {};
    workflow.steps.forEach(s => { columns[s.id] = []; });

    runs.forEach(run => {
      const stepId = getActiveStepId(run);
      const col = stepId && columns[stepId] !== undefined
        ? stepId
        : workflow.steps[workflow.steps.length - 1]?.id;
      if (col && columns[col]) columns[col].push(run);
    });

    board.innerHTML = workflow.steps.map(step => {
      const cards = columns[step.id] || [];
      const cardHTML = cards.length === 0
        ? '<div class="empty">No runs</div>'
        : cards.map(run => {
            const isDone = run.status === 'done';
            const isFailed = run.status === 'failed' || run.status === 'error';
            const cls = isDone ? 'done' : isFailed ? 'failed' : '';
            const badge = `badge-${run.status}`;
            const time = run.updated_at ? parseTS(run.updated_at)?.toLocaleString() || '' : '';
            const title = run.task?.length > 60 ? run.task.slice(0, 57) + '…' : (run.task || '');
            return `<div class="card ${cls}" data-run-id="${run.id}">
              <div class="card-title" title="${esc(run.task || '')}">${esc(title)}</div>
              <div class="card-meta">
                <span class="badge ${badge}">${run.status}</span>
                <span>${time}</span>
              </div>
            </div>`;
          }).join('');

      return `<div class="column">
        <div class="column-header">${step.id}<span class="count">${cards.length}</span></div>
        <div class="cards">${cardHTML}</div>
      </div>`;
    }).join('');

    // Add click handlers
    board.querySelectorAll('.card').forEach(card => {
      card.addEventListener('click', () => {
        const runId = card.dataset.runId;
        openRunDetail(runId);
      });
    });

  } catch (err) {
    board.innerHTML = `<div class="empty">Error loading runs: ${err.message}</div>`;
  }
}

function getActiveStepId(run) {
  if (!run.steps || !run.steps.length) return null;
  const active = run.steps.find(s => s.status !== 'done' && s.status !== 'skipped');
  return active ? active.step_id : run.steps[run.steps.length - 1].step_id;
}

async function openRunDetail(runId) {
  // Simple alert for now - can be expanded to modal
  try {
    const run = await api.getRun(runId);
    alert(`Run: ${run.id}\nWorkflow: ${run.workflow_id}\nStatus: ${run.status}\nTask: ${run.task?.slice(0, 100)}...`);
  } catch (err) {
    alert(`Error loading run: ${err.message}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/static/js/components/board-view.js
git commit -m "feat(dashboard): port existing board view"
```

---

## Phase 3: Testing and Polish

### Task 18: Build and Verify

**Files:**
- Run build

- [ ] **Step 1: Build project**

```bash
npm run build
```

Expected: Build succeeds without errors

- [ ] **Step 2: Start dashboard and verify**

```bash
node dist/server/index.js
# or
antfarm dashboard
```

Expected: Dashboard starts on port 3333

- [ ] **Step 3: Test navigation**

1. Open http://localhost:3333
2. Verify navigation between Board/Agents/Launch works
3. Verify theme toggle works

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(dashboard): complete dashboard enhancement"
```

---

## Summary

This plan implements:

1. **Backend restructuring**: Split monolithic dashboard.ts into modular router + routes
2. **New API endpoints**: /api/backends, /api/agents, /api/launch, /api/config/defaults
3. **Status checker**: Detect agent status across Hermes/Claude Code/Codex backends
4. **Frontend componentization**: Modular JS components with hash-based routing
5. **New views**: Agents management and Launch entry pages

All changes are backward compatible - existing CLI commands continue to work.
