import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentRole } from '../installer/types.js';

export const ANTFARM_PERMISSION_BLOCK_KEY = '_antfarmManagedDeny';

function assertSafeAgentKey(key: string): void {
  if (key.includes('/') || key.includes('..') || key.includes('\\')) {
    throw new Error(`Unsafe agent key "${key}"`);
  }
}

export async function writeSubagentDefinition(params: {
  projectDir: string;
  workflowId: string;
  agentId: string;
  role: AgentRole;
  description: string;
}): Promise<void> {
  const key = `${params.workflowId}_${params.agentId}`;
  assertSafeAgentKey(key);
  const agentsDir = path.join(params.projectDir, '.claude', 'agents');
  await fs.mkdir(agentsDir, { recursive: true });
  const body = `---
name: ${key}
description: ${params.description}
role: ${params.role}
---

You are the \`${key}\` workflow agent. Follow the workflow's role-specific instructions.
Claimed work is delivered via the antfarm CLI. Use read_file, grep, and the tools
permitted by your role.
`;
  await fs.writeFile(path.join(agentsDir, `${key}.md`), body, 'utf-8');
}

export async function removeSubagentDefinition(params: {
  projectDir: string;
  workflowId: string;
  agentId: string;
}): Promise<void> {
  const key = `${params.workflowId}_${params.agentId}`;
  assertSafeAgentKey(key);
  const target = path.join(params.projectDir, '.claude', 'agents', `${key}.md`);
  await fs.rm(target, { force: true });
}

interface ClaudeSettings {
  permissions?: { allow?: string[]; deny?: string[] };
  [ANTFARM_PERMISSION_BLOCK_KEY]?: string[];
  [key: string]: unknown;
}

async function readSettings(settingsPath: string): Promise<ClaudeSettings> {
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(raw) as ClaudeSettings;
  } catch {
    return {};
  }
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

export async function upsertClaudeSettingsPermissions(params: {
  projectDir: string;
  deny: string[];
}): Promise<void> {
  const dir = path.join(params.projectDir, '.claude');
  const file = path.join(dir, 'settings.json');
  await fs.mkdir(dir, { recursive: true });
  const settings = await readSettings(file);
  if (!settings.permissions) settings.permissions = {};
  const existingDeny = settings.permissions.deny ?? [];
  const ours = settings[ANTFARM_PERMISSION_BLOCK_KEY] ?? [];
  const userDeny = existingDeny.filter((d) => !ours.includes(d));
  settings.permissions.deny = uniq([...userDeny, ...params.deny]);
  settings[ANTFARM_PERMISSION_BLOCK_KEY] = uniq(params.deny);
  await fs.writeFile(file, JSON.stringify(settings, null, 2), 'utf-8');
}

export async function removeClaudeSettingsPermissions(params: {
  projectDir: string;
}): Promise<void> {
  const file = path.join(params.projectDir, '.claude', 'settings.json');
  const settings = await readSettings(file);
  const ours = settings[ANTFARM_PERMISSION_BLOCK_KEY] ?? [];
  if (settings.permissions?.deny) {
    settings.permissions.deny = settings.permissions.deny.filter((d) => !ours.includes(d));
    if (settings.permissions.deny.length === 0) delete settings.permissions.deny;
    if (!settings.permissions.allow && !settings.permissions.deny) delete settings.permissions;
  }
  delete settings[ANTFARM_PERMISSION_BLOCK_KEY];
  await fs.writeFile(file, JSON.stringify(settings, null, 2), 'utf-8');
}
