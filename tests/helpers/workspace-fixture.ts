import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Counter for unique temp directory names
let tempDirCounter = 0;

/**
 * Creates a temporary workspace directory with the specified file structure.
 * Automatically cleans up on process exit.
 *
 * @param structure - Map of relative file paths to content strings
 * @returns Path to the created temporary directory
 *
 * @example
 * const dir = createWorkspaceDir({
 *   "src/index.ts": "export const foo = 42;",
 *   "package.json": '{"name": "test"}',
 *   "README.md": "# Test Project"
 * });
 * // dir = "/tmp/antfarm-test-1234567890-0-abc123"
 */
export function createWorkspaceDir(
  structure: Record<string, string>
): string {
  const timestamp = Date.now();
  const counter = tempDirCounter++;
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  const tempDir = path.join(os.tmpdir(), `antfarm-test-${timestamp}-${counter}-${randomSuffix}`);

  // Create the root directory
  fs.mkdirSync(tempDir, { recursive: true });

  // Create files according to structure
  for (const [relativePath, content] of Object.entries(structure)) {
    const filePath = path.join(tempDir, relativePath);
    const dir = path.dirname(filePath);

    // Ensure parent directory exists
    fs.mkdirSync(dir, { recursive: true });

    // Write file content
    fs.writeFileSync(filePath, content, "utf-8");
  }

  // Register cleanup handler
  const cleanup = (): void => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors (e.g., if already cleaned up or permission issues)
    }
  };

  // Cleanup on process exit
  process.once("exit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  return tempDir;
}
