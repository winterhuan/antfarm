import type { Backend } from './interface.js';
import type { WorkflowSpec, WorkflowAgent, AgentRole } from '../installer/types.js';
import { provisionAgents } from '../installer/agent-provision.js';
import { createAgentCronJob, deleteAgentCronJobs } from '../installer/gateway-api.js';
import { buildPollingPrompt } from '../installer/agent-cron.js';
import { readOpenClawConfig, writeOpenClawConfig, type OpenClawConfig } from '../installer/openclaw-config.js';
import { updateMainAgentGuidance } from '../installer/main-agent-guidance.js';
import { addSubagentAllowlist } from '../installer/subagent-allowlist.js';
import { installAntfarmSkill } from '../installer/skill-install.js';

// ── Shared deny list: things no workflow agent should ever touch ──
const ALWAYS_DENY = ["gateway", "cron", "message", "nodes", "canvas", "sessions_send"];

const DEFAULT_CRON_SESSION_RETENTION = "24h";
const DEFAULT_SESSION_MAINTENANCE = {
  mode: "enforce",
  pruneAfter: "7d",
  maxEntries: 500,
  rotateBytes: "10mb",
} as const;

const TIMEOUT_20_MIN = 1200;
const TIMEOUT_30_MIN = 1800;

const ROLE_POLICIES: Record<AgentRole, { profile?: string; alsoAllow?: string[]; deny: string[]; timeoutSeconds: number }> = {
  analysis: {
    profile: "coding",
    deny: [
      ...ALWAYS_DENY,
      "write", "edit", "apply_patch",
      "image", "tts",
      "group:ui",
    ],
    timeoutSeconds: TIMEOUT_20_MIN,
  },
  coding: {
    profile: "coding",
    deny: [
      ...ALWAYS_DENY,
      "image", "tts",
      "group:ui",
    ],
    timeoutSeconds: TIMEOUT_30_MIN,
  },
  verification: {
    profile: "coding",
    deny: [
      ...ALWAYS_DENY,
      "write", "edit", "apply_patch",
      "image", "tts",
      "group:ui",
    ],
    timeoutSeconds: TIMEOUT_20_MIN,
  },
  testing: {
    profile: "coding",
    alsoAllow: ["browser", "web_search", "web_fetch"],
    deny: [
      ...ALWAYS_DENY,
      "write", "edit", "apply_patch",
      "image", "tts",
    ],
    timeoutSeconds: TIMEOUT_30_MIN,
  },
  pr: {
    profile: "coding",
    deny: [
      ...ALWAYS_DENY,
      "write", "edit", "apply_patch",
      "image", "tts",
      "group:ui",
    ],
    timeoutSeconds: TIMEOUT_20_MIN,
  },
  scanning: {
    profile: "coding",
    alsoAllow: ["web_search", "web_fetch"],
    deny: [
      ...ALWAYS_DENY,
      "write", "edit", "apply_patch",
      "image", "tts",
      "group:ui",
    ],
    timeoutSeconds: TIMEOUT_20_MIN,
  },
};

function ensureAgentList(config: { agents?: { list?: Array<Record<string, unknown>>; defaults?: Record<string, unknown> } }) {
  if (!config.agents) config.agents = {};
  if (!Array.isArray(config.agents.list)) config.agents.list = [];
  return config.agents.list;
}

function ensureMainAgentInList(
  list: Array<Record<string, unknown>>,
  config: { agents?: { defaults?: Record<string, unknown> } },
) {
  if (list.some((entry) => entry.default === true)) return;
  const existing = list.find((entry) => entry.id === "main");
  if (existing) {
    existing.default = true;
    return;
  }
  const workspace = (config.agents?.defaults as Record<string, unknown>)?.workspace as string | undefined;
  const entry: Record<string, unknown> = {
    id: "main",
    name: "Main",
    default: true,
  };
  if (workspace) entry.workspace = workspace;
  list.unshift(entry);
}

function ensureCronSessionRetention(config: OpenClawConfig): void {
  if (!config.cron) config.cron = {};
  if (config.cron.sessionRetention === undefined) {
    config.cron.sessionRetention = DEFAULT_CRON_SESSION_RETENTION;
  }
}

function ensureSessionMaintenance(config: OpenClawConfig): void {
  if (!config.session) config.session = {};
  if (!config.session.maintenance) {
    config.session.maintenance = { ...DEFAULT_SESSION_MAINTENANCE };
    return;
  }
  const maintenance = config.session.maintenance;
  if (maintenance.mode === undefined) maintenance.mode = DEFAULT_SESSION_MAINTENANCE.mode;
  if (maintenance.pruneAfter === undefined && maintenance.pruneDays === undefined) {
    maintenance.pruneAfter = DEFAULT_SESSION_MAINTENANCE.pruneAfter;
  }
  if (maintenance.maxEntries === undefined) {
    maintenance.maxEntries = DEFAULT_SESSION_MAINTENANCE.maxEntries;
  }
  if (maintenance.rotateBytes === undefined) {
    maintenance.rotateBytes = DEFAULT_SESSION_MAINTENANCE.rotateBytes;
  }
}

function buildToolsConfig(role: AgentRole): Record<string, unknown> {
  const defaults = ROLE_POLICIES[role];
  const tools: Record<string, unknown> = {};
  if (defaults.profile) tools.profile = defaults.profile;
  if (defaults.alsoAllow?.length) tools.alsoAllow = defaults.alsoAllow;
  tools.deny = defaults.deny;
  return tools;
}

function inferRole(agentId: string): AgentRole {
  const id = agentId.toLowerCase();
  if (id.includes("planner") || id.includes("prioritizer") || id.includes("reviewer")
      || id.includes("investigator") || id.includes("triager")) return "analysis";
  if (id.includes("verifier")) return "verification";
  if (id.includes("tester")) return "testing";
  if (id.includes("scanner")) return "scanning";
  if (id === "pr" || id.includes("/pr")) return "pr";
  return "coding";
}

function upsertAgent(
  list: Array<Record<string, unknown>>,
  agent: { id: string; name?: string; model?: string; workspaceDir: string; agentDir: string; role: AgentRole },
) {
  const existing = list.find((entry) => entry.id === agent.id);
  if (existing?.default === true) return;
  const payload: Record<string, unknown> = {
    id: agent.id,
    name: agent.name ?? agent.id,
    workspace: agent.workspaceDir,
    agentDir: agent.agentDir,
    tools: buildToolsConfig(agent.role),
    subagents: { allowAgents: [] },
  };
  if (agent.model) payload.model = agent.model;
  if (existing) Object.assign(existing, payload);
  else list.push(payload);
}

/**
 * Return the highest configured role timeout (seconds).
 * Used by step-ops to derive the abandoned-step threshold.
 */
export function getMaxRoleTimeoutSeconds(): number {
  return Math.max(...Object.values(ROLE_POLICIES).map(r => r.timeoutSeconds));
}

export class OpenClawBackend implements Backend {
  async install(workflow: WorkflowSpec, sourceDir: string): Promise<void> {
    // Provision agent workspaces
    const provisioned = await provisionAgents({
      workflow,
      workflowDir: sourceDir,
      bundledSourceDir: sourceDir,
    });

    // Build a role lookup: workflow agent id → role (explicit or inferred)
    const roleMap = new Map<string, AgentRole>();
    for (const agent of workflow.agents) {
      roleMap.set(agent.id, agent.role ?? inferRole(agent.id));
    }

    // Update OpenClaw configuration
    const { path: configPath, config } = await readOpenClawConfig();
    ensureCronSessionRetention(config);
    ensureSessionMaintenance(config);
    const list = ensureAgentList(config);
    ensureMainAgentInList(list, config);

    for (const agent of provisioned) {
      const existing = list.find((entry) => entry.id === agent.id);
      if (existing && !agent.id.startsWith(workflow.id + "_")) {
        throw new Error(`Agent ID collision: "${agent.id}" already exists from a different source`);
      }
    }

    addSubagentAllowlist(config, provisioned.map((a) => a.id));

    for (const agent of provisioned) {
      const prefix = workflow.id + "_";
      const localId = agent.id.startsWith(prefix) ? agent.id.slice(prefix.length) : agent.id;
      const role = roleMap.get(localId) ?? inferRole(localId);
      upsertAgent(list, { ...agent, role });
    }

    await writeOpenClawConfig(configPath, config);
    await updateMainAgentGuidance();
    await installAntfarmSkill();

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
    // Clean up OpenClaw-specific resources (cron jobs created by this backend).
    // Note: Agent workspaces and OpenClaw agent entries are managed by installer/uninstall.ts
    // because they require coordination with OpenClaw config file operations.
    await deleteAgentCronJobs(`antfarm/${workflowId}/`);
  }

  async startRun(workflow: WorkflowSpec): Promise<void> {
    // OpenClaw Gateway is already running, nothing to do
  }

  async stopRun(workflow: WorkflowSpec): Promise<void> {
    // Optionally stop cron jobs
    await deleteAgentCronJobs(`antfarm/${workflow.id}/`);
  }
}
