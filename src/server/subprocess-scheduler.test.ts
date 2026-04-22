import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import type { WorkflowAgent } from "../installer/types.js";
import { getCodexExecPaths } from "./subprocess-scheduler.js";

const originalOpenClawStateDir = process.env.OPENCLAW_STATE_DIR;

afterEach(() => {
  if (originalOpenClawStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = originalOpenClawStateDir;
});

describe("getCodexExecPaths", () => {
  it("starts Codex in the agent workspace and grants repo + antfarm state writes", () => {
    process.env.OPENCLAW_STATE_DIR = "/tmp/antfarm-openclaw-state";
    const agent = {
      id: "developer",
      role: "coding",
      workspace: { baseDir: "agents/developer", files: {} },
    } as WorkflowAgent;

    const paths = getCodexExecPaths("feature-dev", agent, "/repo/project");

    assert.equal(
      paths.workspaceDir,
      "/tmp/antfarm-openclaw-state/workspaces/workflows/feature-dev/agents/developer",
    );
    assert.deepEqual(
      paths.addDirs.sort(),
      ["/repo/project", "/tmp/antfarm-openclaw-state/antfarm"].sort(),
    );
  });
});
