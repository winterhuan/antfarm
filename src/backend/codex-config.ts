import fs from 'node:fs/promises';
import path from 'node:path';
import type { CodexSandboxMode } from './codex-policy.js';

export const ANTFARM_BLOCK_BEGIN = '# BEGIN antfarm-managed';
export const ANTFARM_BLOCK_END = '# END antfarm-managed';

export interface AntfarmConfigEntry {
  profileName: string;
  overlayPath: string;
  description: string;
  sandboxMode: CodexSandboxMode;
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
}

function escapeTomlTripleQuoted(s: string): string {
  return s.replace(/"""/g, '""\\"');
}

function tomlBasicString(s: string): string {
  return JSON.stringify(s);
}

export async function writeRoleOverlayFile(params: {
  filePath: string;
  model: string;
  sandboxMode: CodexSandboxMode;
  modelReasoningEffort: 'low' | 'medium' | 'high';
  developerInstructions: string;
}): Promise<void> {
  const lines: string[] = [
    '# Managed by antfarm — overwritten on `antfarm workflow install`. Do not edit.',
    '',
    `model = ${tomlBasicString(params.model)}`,
    `sandbox_mode = ${tomlBasicString(params.sandboxMode)}`,
    `model_reasoning_effort = ${tomlBasicString(params.modelReasoningEffort)}`,
    '',
    'developer_instructions = """',
    escapeTomlTripleQuoted(params.developerInstructions),
    '"""',
    '',
  ];
  await fs.mkdir(path.dirname(params.filePath), { recursive: true });
  await fs.writeFile(params.filePath, lines.join('\n'), 'utf-8');
}

export async function removeRoleOverlayFiles(params: {
  agentsDir: string;
  workflowId: string;
}): Promise<void> {
  const prefix = `antfarm-${params.workflowId}-`;
  let entries: string[] = [];
  try { entries = await fs.readdir(params.agentsDir); } catch { return; }
  for (const name of entries) {
    if (name.startsWith(prefix) && name.endsWith('.toml')) {
      await fs.rm(path.join(params.agentsDir, name), { force: true });
    }
  }
}

function formatAntfarmBlock(entries: AntfarmConfigEntry[]): string {
  if (entries.length === 0) return '';
  const parts: string[] = [ANTFARM_BLOCK_BEGIN];
  for (const e of entries) {
    parts.push('');
    parts.push(`[profiles.${tomlBasicString(e.profileName)}]`);
    parts.push(`model = ${tomlBasicString(e.model)}`);
    parts.push(`sandbox_mode = ${tomlBasicString(e.sandboxMode)}`);
    parts.push(`model_reasoning_effort = ${tomlBasicString(e.reasoningEffort)}`);
    parts.push('');
    parts.push(`[agent_roles.${tomlBasicString(e.profileName)}]`);
    parts.push(`description = ${tomlBasicString(e.description)}`);
    parts.push(`config_file = ${tomlBasicString(e.overlayPath)}`);
  }
  parts.push(ANTFARM_BLOCK_END);
  return parts.join('\n') + '\n';
}

function stripExistingBlock(content: string): string {
  const beginIdx = content.indexOf(ANTFARM_BLOCK_BEGIN);
  if (beginIdx === -1) return content;
  const endIdx = content.indexOf(ANTFARM_BLOCK_END, beginIdx);
  if (endIdx === -1) return content;
  const after = endIdx + ANTFARM_BLOCK_END.length;
  const tail = content.slice(after).replace(/^\n/, '');
  const head = content.slice(0, beginIdx).replace(/\s+$/, '');
  if (!head) return tail;
  if (!tail) return head + '\n';
  return head + '\n\n' + tail;
}

export async function upsertAntfarmConfigBlock(params: {
  configPath: string;
  entries: AntfarmConfigEntry[];
}): Promise<void> {
  let content = '';
  try { content = await fs.readFile(params.configPath, 'utf-8'); } catch { /* new file */ }

  const stripped = stripExistingBlock(content);
  const block = formatAntfarmBlock(params.entries);

  let final: string;
  if (!block) {
    final = stripped;
  } else if (!stripped.trim()) {
    final = block;
  } else {
    final = stripped.replace(/\s+$/, '') + '\n\n' + block;
  }

  await fs.mkdir(path.dirname(params.configPath), { recursive: true });
  await fs.writeFile(params.configPath, final, 'utf-8');
}

/**
 * Parse the antfarm block and return all entries that do NOT match the given
 * workflow prefix. Then rewrite the block with those entries. If no entries
 * remain, the whole block is removed.
 */
export async function removeWorkflowEntriesFromConfigBlock(params: {
  configPath: string;
  workflowId: string;
}): Promise<void> {
  let content = '';
  try { content = await fs.readFile(params.configPath, 'utf-8'); } catch { return; }
  if (!content.includes(ANTFARM_BLOCK_BEGIN)) return;

  const beginIdx = content.indexOf(ANTFARM_BLOCK_BEGIN);
  const endIdx = content.indexOf(ANTFARM_BLOCK_END, beginIdx);
  if (endIdx === -1) return;
  const block = content.slice(beginIdx, endIdx + ANTFARM_BLOCK_END.length);

  const kept: AntfarmConfigEntry[] = parseAntfarmBlock(block).filter(
    (e) => !e.profileName.startsWith(`antfarm-${params.workflowId}-`),
  );

  await upsertAntfarmConfigBlock({ configPath: params.configPath, entries: kept });
}

/**
 * Parse a single antfarm-managed block back into entries. This is a narrow
 * parser: it only recognizes the shape that `formatAntfarmBlock` emits.
 */
export function parseAntfarmBlock(block: string): AntfarmConfigEntry[] {
  const entries: Map<string, Partial<AntfarmConfigEntry> & { profileName: string }> = new Map();
  const lines = block.split('\n');
  let currentName: string | null = null;
  let currentSection: 'profile' | 'role' | null = null;
  for (const line of lines) {
    const profMatch = line.match(/^\[profiles\."([^"]+)"\]$/);
    if (profMatch) {
      currentName = profMatch[1];
      currentSection = 'profile';
      if (!entries.has(currentName)) {
        entries.set(currentName, { profileName: currentName });
      }
      continue;
    }
    const roleMatch = line.match(/^\[agent_roles\."([^"]+)"\]$/);
    if (roleMatch) {
      currentName = roleMatch[1];
      currentSection = 'role';
      if (!entries.has(currentName)) {
        entries.set(currentName, { profileName: currentName });
      }
      continue;
    }
    if (!currentName || !currentSection) continue;
    const kvMatch = line.match(/^([a-z_]+)\s*=\s*"([^"]*)"$/);
    if (!kvMatch) continue;
    const [, key, value] = kvMatch;
    const entry = entries.get(currentName)!;
    if (currentSection === 'profile') {
      if (key === 'model') entry.model = value;
      else if (key === 'sandbox_mode') entry.sandboxMode = value as CodexSandboxMode;
      else if (key === 'model_reasoning_effort') entry.reasoningEffort = value as 'low' | 'medium' | 'high';
    } else {
      if (key === 'description') entry.description = value;
      else if (key === 'config_file') entry.overlayPath = value;
    }
  }
  const result: AntfarmConfigEntry[] = [];
  for (const e of entries.values()) {
    if (e.model && e.sandboxMode && e.reasoningEffort && e.description && e.overlayPath) {
      result.push(e as AntfarmConfigEntry);
    }
  }
  return result;
}
