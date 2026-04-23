import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

/**
 * Creates a temp git repo with an initial commit on main branch.
 */
export function createGitRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antfarm-git-"));
  execSync("git init && git checkout -b main", { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "# test");
  execSync("git add . && git commit -m 'init'", { cwd: dir });
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
