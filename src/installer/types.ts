export type WorkflowAgentFiles = {
  readonly baseDir: string;
  readonly files: Readonly<Record<string, string>>;
  readonly skills?: ReadonlyArray<string>;
};

/**
 * Agent roles control tool access during install.
 *
 * - analysis:      Read-only style code exploration (planner, prioritizer, reviewer, investigator, triager)
 * - coding:        Full read/write/exec for implementation (developer, fixer, setup)
 * - verification:  Validation-focused execution; should not modify repo source files (verifier)
 * - testing:       Test-focused execution with browser/web access; should not modify app source files (tester)
 * - pr:            PR-focused execution; should not edit repo source files or tests (pr)
 * - scanning:      Security scanning with web search; should not modify repo source files (scanner)
 */
export type AgentRole = "analysis" | "coding" | "verification" | "testing" | "pr" | "scanning";

export type WorkflowAgent = {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly role?: AgentRole;
  readonly model?: string;
  readonly pollingModel?: string;
  readonly timeoutSeconds?: number;
  readonly backend?: "openclaw" | "hermes" | "claude-code" | "codex";
  readonly workspace: WorkflowAgentFiles;
};

export type PollingConfig = {
  readonly model?: string;
  readonly timeoutSeconds?: number;
};

export type WorkflowStepFailure = {
  readonly retry_step?: string;
  readonly max_retries?: number;
  readonly on_exhausted?: { readonly escalate_to: string } | { readonly escalate_to?: string } | undefined;
  readonly escalate_to?: string;
};

export type LoopConfig = {
  readonly over: "stories";
  readonly completion: "all_done";
  readonly freshSession?: boolean;
  readonly verifyEach?: boolean;
  readonly verifyStep?: string;
};

export type WorkflowStep = {
  readonly id: string;
  readonly agent: string;
  readonly type?: "single" | "loop";
  readonly loop?: LoopConfig;
  readonly input: string;
  readonly expects: string;
  readonly max_retries?: number;
  readonly on_fail?: WorkflowStepFailure;
};

export type Story = {
  readonly id: string;
  readonly runId: string;
  readonly storyIndex: number;
  readonly storyId: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly status: "pending" | "running" | "done" | "failed";
  readonly output?: string;
  readonly retryCount: number;
  readonly maxRetries: number;
};

export type WorkflowSpec = {
  readonly id: string;
  readonly name?: string;
  readonly version?: number;
  readonly defaultBackend?: "openclaw" | "hermes" | "claude-code" | "codex";
  readonly polling?: PollingConfig;
  readonly agents: ReadonlyArray<WorkflowAgent>;
  readonly steps: ReadonlyArray<WorkflowStep>;
  readonly context?: Readonly<Record<string, string>>;
  readonly notifications?: {
    readonly url?: string;
  };
};

export type WorkflowInstallResult = {
  readonly workflowId: string;
  readonly workflowDir: string;
};

export type StepResult = {
  readonly stepId: string;
  readonly agentId: string;
  readonly output: string;
  readonly status: "done" | "retry" | "blocked";
  readonly completedAt: string;
};

export type WorkflowRunRecord = {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowName?: string;
  readonly taskTitle: string;
  readonly status: "running" | "paused" | "blocked" | "completed" | "canceled";
  readonly leadAgentId: string;
  readonly leadSessionLabel: string;
  readonly currentStepIndex: number;
  readonly currentStepId?: string;
  readonly stepResults: ReadonlyArray<StepResult>;
  readonly retryCount: number;
  readonly context: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly updatedAt: string;
};
