import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentRole } from '../installer/types.js';

function assertSafeAgentKey(key: string): void {
  if (key.includes('/') || key.includes('..') || key.includes('\\') || key.includes('"')) {
    throw new Error(`Unsafe agent key "${key}"`);
  }
}

export async function writeSubagentDefinition(params: {
  projectDir: string;
  workflowId: string;
  agentId: string;
  role: AgentRole;
  description: string;
  disallowedTools?: string;
}): Promise<void> {
  const key = `${params.workflowId}_${params.agentId}`;
  assertSafeAgentKey(key);
  const agentsDir = path.join(params.projectDir, '.claude', 'agents');
  await fs.mkdir(agentsDir, { recursive: true });

  const lines = [
    '---',
    `name: ${key}`,
    `description: ${params.description}`,
    `role: ${params.role}`,
  ];
  if (params.disallowedTools) {
    lines.push(`disallowedTools: ${params.disallowedTools}`);
  }
  lines.push('---', '');
  lines.push(
    `You are the \`${key}\` workflow agent. Follow the workflow's role-specific instructions.`,
    'Claimed work is delivered via the antfarm CLI. Use read_file, grep, and the tools',
    'permitted by your role.',
    '',
  );
  await fs.writeFile(path.join(agentsDir, `${key}.md`), lines.join('\n'), 'utf-8');
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
