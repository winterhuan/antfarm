import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";
import type { BackendType } from "../backend/interface.js";

export interface AntfarmConfig {
  /** Default backend to use when not specified elsewhere */
  defaultBackend?: BackendType;
  /** Other global settings can be added here */
  notifications?: {
    url?: string;
  };
}

const CONFIG_FILENAME = "config.yaml";

export function resolveAntfarmConfigDir(): string {
  return path.join(os.homedir(), ".config", "antfarm");
}

export function resolveAntfarmConfigPath(): string {
  return path.join(resolveAntfarmConfigDir(), CONFIG_FILENAME);
}

export async function readAntfarmConfig(): Promise<AntfarmConfig> {
  const configPath = resolveAntfarmConfigPath();
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    return YAML.parse(raw) as AntfarmConfig;
  } catch (err) {
    // If file doesn't exist, return empty config
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

export async function writeAntfarmConfig(config: AntfarmConfig): Promise<void> {
  const configDir = resolveAntfarmConfigDir();
  const configPath = resolveAntfarmConfigPath();
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, YAML.stringify(config), "utf-8");
}

/**
 * Get the default backend from global config, falling back to 'openclaw'
 */
export async function getGlobalDefaultBackend(): Promise<BackendType> {
  const config = await readAntfarmConfig();
  return config.defaultBackend ?? "openclaw";
}
