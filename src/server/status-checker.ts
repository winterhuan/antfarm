import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(execFile);

export type BackendType = "hermes" | "claude-code" | "codex" | "openclaw";

export interface AgentStatus {
  id: string;
  name: string;
  backend: BackendType;
  workflowId: string;
  state: "active" | "inactive" | "error" | "unknown";
  lastChecked: string;
  details?: Record<string, unknown>;
}

export interface BackendStatus {
  type: BackendType;
  available: boolean;
  version?: string;
  error?: string;
}

// ─── Hermes Status ───

interface HermesProfileInfo {
  name: string;
  workflowId: string;
  agentId: string;
  hasMarker: boolean;
  cronJobs: Array<{ id: string; name: string; schedule: string; active: boolean }>;
}

async function getHermesHome(): Promise<string> {
  return process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
}

async function listHermesProfiles(): Promise<string[]> {
  const profilesDir = path.join(await getHermesHome(), "profiles");
  try {
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function parseHermesCronList(profileName: string): Promise<Array<{ id: string; name: string; schedule: string; active: boolean }>> {
  try {
    const { stdout } = await execAsync("hermes", ["--profile", profileName, "cron", "list"]);
    const jobs: Array<{ id: string; name: string; schedule: string; active: boolean }> = [];
    const lines = stdout.split("\n");
    let currentJob: Partial<{ id: string; name: string; schedule: string; active: boolean }> = {};

    for (const line of lines) {
      const idMatch = line.match(/^\s*([a-f0-9]{6,})\s+\[(active|inactive)\]/i);
      if (idMatch) {
        if (currentJob.id) jobs.push(currentJob as typeof jobs[0]);
        currentJob = {
          id: idMatch[1],
          active: idMatch[2].toLowerCase() === "active",
        };
        continue;
      }

      const nameMatch = line.match(/^\s*Name:\s*(.+)$/);
      if (nameMatch) {
        currentJob.name = nameMatch[1].trim();
        continue;
      }

      const scheduleMatch = line.match(/^\s*Schedule:\s*(.+)$/);
      if (scheduleMatch) {
        currentJob.schedule = scheduleMatch[1].trim();
      }
    }

    if (currentJob.id) jobs.push(currentJob as typeof jobs[0]);
    return jobs;
  } catch {
    return [];
  }
}

async function readHermesMarker(profileDir: string): Promise<{ workflowId: string; version: number } | null> {
  try {
    const content = await fs.readFile(path.join(profileDir, ".antfarm"), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function getHermesWorkflowAgents(workflowId: string): Promise<AgentStatus[]> {
  const profilesDir = path.join(await getHermesHome(), "profiles");
  const prefix = `${workflowId}_`;
  const profiles = await listHermesProfiles();
  const results: AgentStatus[] = [];

  for (const profileName of profiles) {
    if (!profileName.startsWith(prefix)) continue;

    const agentId = profileName.slice(prefix.length);
    const profileDir = path.join(profilesDir, profileName);
    const marker = await readHermesMarker(profileDir);

    if (!marker || marker.workflowId !== workflowId) continue;

    const cronJobs = await parseHermesCronList(profileName);
    const antfarmCrons = cronJobs.filter((c) => c.name?.startsWith(`antfarm/${workflowId}/`));
    const hasActiveCron = antfarmCrons.some((c) => c.active);

    results.push({
      id: agentId,
      name: agentId,
      backend: "hermes",
      workflowId,
      state: hasActiveCron ? "active" : "inactive",
      lastChecked: new Date().toISOString(),
      details: {
        profile: profileName,
        cronJobs: antfarmCrons,
        hasMarker: true,
      },
    });
  }

  return results;
}

// ─── Claude Code Status ───

export async function getClaudeCodeWorkflowAgents(workflowId: string, projectDir?: string): Promise<AgentStatus[]> {
  const targetDir = projectDir || process.cwd();
  const agentsDir = path.join(targetDir, ".claude", "agents");
  const prefix = `${workflowId}_`;

  try {
    const entries = await fs.readdir(agentsDir);
    const results: AgentStatus[] = [];

    for (const entry of entries) {
      if (!entry.startsWith(prefix) || !entry.endsWith(".md")) continue;

      const agentId = entry.slice(prefix.length, -3);
      const stats = await fs.stat(path.join(agentsDir, entry));

      results.push({
        id: agentId,
        name: agentId,
        backend: "claude-code",
        workflowId,
        state: "active", // Claude Code agents are config-based, always "active" if file exists
        lastChecked: new Date().toISOString(),
        details: {
          configFile: entry,
          modifiedAt: stats.mtime.toISOString(),
        },
      });
    }

    return results;
  } catch {
    return [];
  }
}

// ─── Codex Status ───

async function getCodexHome(): Promise<string> {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

async function parseCodexConfig(): Promise<Array<{ profileName: string; model?: string; sandboxMode?: string }>> {
  const configPath = path.join(await getCodexHome(), "config.toml");
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const entries: Array<{ profileName: string; model?: string; sandboxMode?: string }> = [];

    // Parse antfarm-managed block
    const beginMatch = content.match(/# BEGIN antfarm-managed/);
    const endMatch = content.match(/# END antfarm-managed/);

    if (!beginMatch || !endMatch) return [];

    const block = content.slice(beginMatch.index, endMatch.index);
    const profileMatches = block.matchAll(/\[profiles\.["'](antfarm-[^"']+)["']\]/g);

    for (const match of profileMatches) {
      const profileName = match[1];
      // Extract model and sandbox from subsequent lines
      const sectionStart = match.index! + match[0].length;
      const sectionEnd = block.indexOf("[", sectionStart);
      const section = block.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);

      const modelMatch = section.match(/model\s*=\s*["']([^"']+)["']/);
      const sandboxMatch = section.match(/sandbox_mode\s*=\s*["']([^"']+)["']/);

      entries.push({
        profileName,
        model: modelMatch?.[1],
        sandboxMode: sandboxMatch?.[1],
      });
    }

    return entries;
  } catch {
    return [];
  }
}

export async function getCodexWorkflowAgents(workflowId: string): Promise<AgentStatus[]> {
  const prefix = `antfarm-${workflowId}-`;
  const entries = await parseCodexConfig();
  const results: AgentStatus[] = [];

  for (const entry of entries) {
    if (!entry.profileName.startsWith(prefix)) continue;

    const agentId = entry.profileName.slice(prefix.length);
    const overlayPath = path.join(await getCodexHome(), "agents", `${entry.profileName}.toml`);

    try {
      await fs.access(overlayPath);
      results.push({
        id: agentId,
        name: agentId,
        backend: "codex",
        workflowId,
        state: "active",
        lastChecked: new Date().toISOString(),
        details: {
          profile: entry.profileName,
          model: entry.model,
          sandboxMode: entry.sandboxMode,
        },
      });
    } catch {
      results.push({
        id: agentId,
        name: agentId,
        backend: "codex",
        workflowId,
        state: "error",
        lastChecked: new Date().toISOString(),
        details: {
          profile: entry.profileName,
          error: "Overlay file missing",
        },
      });
    }
  }

  return results;
}

// ─── OpenClaw Status ───

async function getOpenClawConfig(): Promise<{ agents?: { list?: Array<{ id: string; name?: string }> } } | null> {
  // OpenClaw config is in a standard location or via env
  const configDir = process.env.OPENCLAW_CONFIG_DIR || path.join(os.homedir(), ".openclaw");
  try {
    const content = await fs.readFile(path.join(configDir, "config.yaml"), "utf-8");
    // Simple YAML parsing for agent list
    const agents: Array<{ id: string; name?: string }> = [];
    const lines = content.split("\n");
    let inAgentsList = false;

    for (const line of lines) {
      if (line.startsWith("agents:")) {
        inAgentsList = true;
        continue;
      }
      if (inAgentsList && line.startsWith("  list:")) {
        continue;
      }
      if (inAgentsList && line.match(/^  \S/)) {
        inAgentsList = false;
        continue;
      }
      if (inAgentsList) {
        const match = line.match(/^    -\s+id:\s*(\S+)/);
        if (match) {
          agents.push({ id: match[1] });
        }
      }
    }

    return { agents: { list: agents } };
  } catch {
    return null;
  }
}

export async function getOpenClawWorkflowAgents(workflowId: string): Promise<AgentStatus[]> {
  const config = await getOpenClawConfig();
  if (!config?.agents?.list) return [];

  const prefix = `${workflowId}_`;
  const results: AgentStatus[] = [];

  for (const agent of config.agents.list) {
    if (!agent.id.startsWith(prefix)) continue;

    const agentId = agent.id.slice(prefix.length);
    results.push({
      id: agentId,
      name: agent.name || agentId,
      backend: "openclaw",
      workflowId,
      state: "active", // Config-based, active if present
      lastChecked: new Date().toISOString(),
      details: {
        fullId: agent.id,
      },
    });
  }

  return results;
}

// ─── Backend Availability ───

export async function checkBackendAvailability(): Promise<BackendStatus[]> {
  const results: BackendStatus[] = [];

  // Check Hermes
  try {
    const { stdout } = await execAsync("hermes", ["--version"]);
    results.push({
      type: "hermes",
      available: true,
      version: stdout.trim(),
    });
  } catch {
    results.push({ type: "hermes", available: false });
  }

  // Check Claude Code
  try {
    const { stdout } = await execAsync("claude", ["--version"]);
    results.push({
      type: "claude-code",
      available: true,
      version: stdout.trim(),
    });
  } catch {
    results.push({ type: "claude-code", available: false });
  }

  // Check Codex
  try {
    const { stdout } = await execAsync("codex", ["--version"]);
    results.push({
      type: "codex",
      available: true,
      version: stdout.trim(),
    });
  } catch {
    results.push({ type: "codex", available: false });
  }

  // Check OpenClaw
  try {
    // OpenClaw may not have a version flag, check for config dir
    const configDir = process.env.OPENCLAW_CONFIG_DIR || path.join(os.homedir(), ".openclaw");
    await fs.access(configDir);
    results.push({
      type: "openclaw",
      available: true,
    });
  } catch {
    results.push({ type: "openclaw", available: false });
  }

  return results;
}

// ─── Aggregated Status ───

export async function getAllWorkflowAgents(workflowId: string): Promise<AgentStatus[]> {
  const [hermes, claudeCode, codex, openclaw] = await Promise.all([
    getHermesWorkflowAgents(workflowId).catch(() => [] as AgentStatus[]),
    getClaudeCodeWorkflowAgents(workflowId).catch(() => [] as AgentStatus[]),
    getCodexWorkflowAgents(workflowId).catch(() => [] as AgentStatus[]),
    getOpenClawWorkflowAgents(workflowId).catch(() => [] as AgentStatus[]),
  ]);

  return [...hermes, ...claudeCode, ...codex, ...openclaw];
}
