# Dashboard Enhancement Design

## Overview

Enhance the Antfarm Dashboard with two new main features:
1. **Agent Management Page** - Full lifecycle management for backend agents (Hermes/Claude Code/Codex/OpenClaw)
2. **Launch Entry Page** - Web interface to start new workflow runs with quick and advanced modes

## Architecture

### File Structure

```
src/server/
├── index.ts                 # HTTP server entry (creates server, starts port)
├── router.ts                # Route dispatcher (URL → handler mapping)
├── routes/
│   ├── workflows.ts         # /api/workflows, /api/runs/*
│   ├── agents.ts            # /api/agents/*, /api/backends
│   └── launch.ts            # /api/launch, /api/config/defaults
├── status-checker.ts        # Backend agent status detection
└── static/
    ├── index.html           # Minimal shell (loads framework)
    ├── css/
    │   └── theme.css        # CSS variables + theme tokens
    └── js/
        ├── router.js        # Frontend routing (hash-based)
        ├── api.js           # Unified fetch wrapper
        └── components/
            ├── layout.js    # Header + sidebar navigation
            ├── board-view.js      # Existing kanban view
            ├── agents-view.js     # Agent management
            └── launch-view.js     # Run launch interface
```

### Route Dispatcher Pattern

```typescript
// router.ts - clean separation
export function dispatch(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url!, `http://localhost:${port}`)

  if (url.pathname.startsWith('/api/workflows')) return workflowsRoute(req, res)
  if (url.pathname.startsWith('/api/agents')) return agentsRoute(req, res)
  if (url.pathname.startsWith('/api/launch')) return launchRoute(req, res)
  if (url.pathname.startsWith('/api/backends')) return backendsRoute(req, res)

  // Static assets
  serveStatic(req, res)
}
```

## API Endpoints

### New Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/backends` | List supported backend types with metadata |
| GET | `/api/agents` | List all installed agents with status |
| POST | `/api/agents/:id/start` | Start agent gateway/scheduler |
| POST | `/api/agents/:id/stop` | Stop agent gateway/scheduler |
| POST | `/api/launch` | Start new workflow run |
| GET | `/api/config/defaults` | Get default configuration values |

### Agent Response Schema

```typescript
interface AgentInfo {
  id: string                    // full agent id (e.g., "feature-dev_planner")
  workflowId: string
  agentId: string                // short id (e.g., "planner")
  backend: 'openclaw' | 'hermes' | 'claude-code' | 'codex'
  status: 'running' | 'stopped' | 'error' | 'unknown'
  workspacePath?: string
  lastSeen?: string
  config: {
    model?: string
    timeoutSeconds?: number
    role?: string
  }
}
```

### Launch Request Schema

```typescript
interface LaunchRequest {
  workflowId: string
  task: string
  backend?: 'openclaw' | 'hermes' | 'claude-code' | 'codex'
  model?: string
  timeoutSeconds?: number
  notifyUrl?: string
}
```

## Page Designs

### Agents Management Page

**Layout**: Two-pane layout
- Left: View toggle (By Workflow / By Backend) + Filter input
- Right: Agent cards grid

**Agent Card**:
```
┌─────────────────────────────────────┐
│ [Icon] feature-dev_planner    [●] │  ← Status dot (green=running)
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│ Workflow: feature-dev               │
│ Backend:  Hermes                    │
│ Model:    default                   │
│ Role:     analysis                  │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│ [Start] [Stop] [Config ▼]           │
└─────────────────────────────────────┘
```

**Group Views**:
1. **By Workflow**: Tree view - workflow expandable, shows its agents
2. **By Backend**: Flat list grouped by backend type

### Launch Page

**Layout**: Split panel

**Left - Quick Start** (always visible):
```
┌─────────────────────────────────────┐
│ Quick Start                         │
│                                     │
│ Workflow    [▼ feature-dev    ]   │
│                                     │
│ Task        ┌─────────────────┐    │
│             │ Add user auth...  │    │
│             │                 │    │
│             └─────────────────┘    │
│                                     │
│     [      ▶ Start Run      ]      │
│                                     │
└─────────────────────────────────────┘
```

**Right - Advanced Config** (collapsible):
```
┌─────────────────────────────────────┐
│ ▼ Advanced Configuration            │
│                                     │
│ Backend     (○) OpenClaw            │
│             (●) Hermes      ← default │
│             (○) Claude Code         │
│             (○) Codex               │
│                                     │
│ Model       [▼ default          ]   │
│ Timeout     [▼ 30 minutes       ]   │
│ Notify URL  [                    ]  │
└─────────────────────────────────────┘
```

**Flow**:
1. Select workflow → Pre-fill defaults (backend from workflow config, model from agent config)
2. Click "Start" → POST `/api/launch` → On success, redirect to Runs page with new run highlighted

## Backend Status Detection

### Implementation Strategy

| Backend | Detection Method |
|---------|-----------------|
| Hermes | Parse `~/.hermes/profiles/<name>/.antfarm` marker → verify ownership → check gateway status via `hermes --profile <name> gateway status` |
| Claude Code | Check `.claude/agents/<workflow>_<agent>.md` exists → check SubprocessScheduler active runs in database |
| Codex | Check `~/.codex/agents/antfarm-<workflow>-<agent>.toml` exists → check if profile in config.toml |
| OpenClaw | Query database runs table + check active subprocesses |

### status-checker.ts

```typescript
export async function getAgentStatus(
  workflowId: string,
  agentId: string,
  backend: BackendType
): Promise<AgentStatus>

export async function listAllAgents(): Promise<AgentInfo[]>
```

## Frontend Component Architecture

### Router (Hash-based)

```javascript
// URL → View mapping
'#/board'   → renderBoardView()
'#/agents'  → renderAgentsView()
'#/launch'  → renderLaunchView()
'#/runs/:id'→ renderRunDetailView(runId)

// Default
'' or '#/'  → redirect to '#/board'
```

### Component Structure

```
layout.js (shared)
├── Header
│   ├── Logo + Title
│   ├── Navigation (Board | Agents | Launch)
│   ├── Theme Toggle
│   └── Medic Badge
└── Main Content Area (swapped by router)
    ├── board-view.js
    ├── agents-view.js
    └── launch-view.js
```

### API Client

```javascript
// api.js - thin wrapper around fetch
const api = {
  async getWorkflows() { return fetchJSON('/api/workflows') },
  async getAgents() { return fetchJSON('/api/agents') },
  async getBackends() { return fetchJSON('/api/backends') },
  async startAgent(id) { return postJSON(`/api/agents/${id}/start`) },
  async stopAgent(id) { return postJSON(`/api/agents/${id}/stop`) },
  async launch(data) { return postJSON('/api/launch', data) },
}
```

## Error Handling

### API Errors
- 400: Invalid request (malformed JSON, missing required fields)
- 404: Agent/workflow not found
- 409: Agent already running/stopped (conflict)
- 500: Backend command failed (stderr in response body)

### UI Feedback
- Toast notifications for async operations (start/stop/launch)
- Inline error states in forms
- Agent cards show error icon with tooltip on status check failure

## Security Considerations

1. **Path Traversal**: All agent IDs sanitized before filesystem access
2. **Command Injection**: Backend commands use array args, not string concatenation
3. **CORS**: Dashboard already sets `Access-Control-Allow-Origin: *` for local development

## Testing Strategy

1. **Unit Tests**: status-checker.ts with mocked filesystem/backend commands
2. **API Tests**: Each new endpoint with valid/invalid inputs
3. **E2E**: Launch workflow → verify appears in Board → stop via Agents page

## Migration Notes

1. Existing `dashboard.ts` logic moves to `routes/workflows.ts`
2. `index.html` inline CSS/JS extracts to static files
3. No breaking changes to existing CLI commands
4. Dashboard URL and port remain the same

## Dependencies

No new npm dependencies. Uses:
- Node.js built-in `http`, `fs`, `path`
- Existing `yaml` package for workflow parsing
- Existing database via `getDb()`
