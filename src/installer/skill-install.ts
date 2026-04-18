import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { resolveAntfarmCli } from "./paths.js";

/**
 * Get the path to the antfarm skills directory (bundled with antfarm).
 */
function getAntfarmSkillsDir(): string {
  // Skills are in the antfarm package under skills/
  return path.join(import.meta.dirname, "..", "..", "skills");
}

/**
 * OpenClaw scans ~/.openclaw/skills/<skill>/SKILL.md by default.
 */
function getOpenClawUserSkillsDir(): string {
  return path.join(os.homedir(), ".openclaw", "skills");
}

/**
 * Hermes scans $HERMES_HOME/skills/<skill>/SKILL.md (HERMES_HOME defaults to ~/.hermes/).
 * The `default` profile shares the top-level HERMES_HOME.
 */
function getHermesUserSkillsDir(): string {
  const hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
  return path.join(hermesHome, "skills");
}

function applySubstitutions(template: string, substitutions: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(substitutions)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

/**
 * Core skill installer: read SKILL.md template, substitute `{{key}}` placeholders,
 * and write it into `<destDir>/antfarm-workflows/SKILL.md`.
 */
async function writeAntfarmSkill(
  destDir: string,
  substitutions: Record<string, string>,
): Promise<{ installed: boolean; path: string }> {
  const srcDir = path.join(getAntfarmSkillsDir(), "antfarm-workflows");
  const destSkillDir = path.join(destDir, "antfarm-workflows");

  await fs.mkdir(destDir, { recursive: true });

  try {
    await fs.access(srcDir);
    await fs.mkdir(destSkillDir, { recursive: true });

    const template = await fs.readFile(path.join(srcDir, "SKILL.md"), "utf-8");
    const rendered = applySubstitutions(template, substitutions);
    await fs.writeFile(path.join(destSkillDir, "SKILL.md"), rendered, "utf-8");

    return { installed: true, path: destSkillDir };
  } catch {
    return { installed: false, path: destSkillDir };
  }
}

/**
 * OpenClaw-specific force-trigger guidance: uses the Gateway cron tool.
 */
const OPENCLAW_FORCE_TRIGGER = `To skip the 5-min cron wait, use the \`cron\` tool with \`action: "run"\` and the agent's job ID. List crons to find them — they're named \`antfarm/<workflow-id>/<agent-id>\`.`;

/**
 * Hermes-specific force-trigger guidance: cron jobs live in per-agent profiles.
 */
const HERMES_FORCE_TRIGGER = `To skip the 5-min cron wait, run \`hermes --profile <workflow-id>_<agent-id> cron run <job-id>\` (find job IDs with \`hermes --profile <workflow-id>_<agent-id> cron list\`). Cron jobs are named \`antfarm/<workflow-id>/<agent-id>\`.`;

/**
 * Install the antfarm-workflows skill into OpenClaw's user skills directory.
 */
export async function installAntfarmSkill(): Promise<{ installed: boolean; path: string }> {
  return writeAntfarmSkill(getOpenClawUserSkillsDir(), {
    antfarmCli: `node ${resolveAntfarmCli()}`,
    forceTriggerSection: OPENCLAW_FORCE_TRIGGER,
  });
}

/**
 * Uninstall the antfarm-workflows skill from OpenClaw's user skills directory.
 */
export async function uninstallAntfarmSkill(): Promise<void> {
  const destDir = path.join(getOpenClawUserSkillsDir(), "antfarm-workflows");
  try {
    await fs.rm(destDir, { recursive: true, force: true });
  } catch {
    // Already gone
  }
}

/**
 * Install the antfarm-workflows skill into Hermes's default profile skills
 * directory (HERMES_HOME/skills/antfarm-workflows/SKILL.md). Idempotent —
 * overwrites SKILL.md so updates to the template propagate on each install.
 */
export async function installAntfarmSkillForHermes(): Promise<{ installed: boolean; path: string }> {
  return writeAntfarmSkill(getHermesUserSkillsDir(), {
    antfarmCli: `node ${resolveAntfarmCli()}`,
    forceTriggerSection: HERMES_FORCE_TRIGGER,
  });
}

/**
 * Uninstall the antfarm-workflows skill from Hermes's default profile skills directory.
 */
export async function uninstallAntfarmSkillForHermes(): Promise<void> {
  const destDir = path.join(getHermesUserSkillsDir(), "antfarm-workflows");
  try {
    await fs.rm(destDir, { recursive: true, force: true });
  } catch {
    // Already gone
  }
}
