import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Creates a temp directory and saves original env vars for cleanup.
 * Call `cleanup()` in afterEach to restore state.
 */
export async function createIsolatedEnv(envVars: string[] = []) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "antfarm-test-"));
  const saved: Record<string, string | undefined> = {};

  for (const key of envVars) {
    saved[key] = process.env[key];
  }

  return {
    tmpDir,
    saved,
    async cleanup() {
      for (const [key, val] of Object.entries(saved)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}
