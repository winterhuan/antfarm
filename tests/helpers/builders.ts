import type {
  WorkflowSpec,
  WorkflowAgent,
  WorkflowStep,
  Story,
  WorkflowRunRecord,
  StepResult,
} from "../../src/installer/types.js";
import type { Backend, BackendType } from "../../src/backend/interface.js";

// Counter for generating unique IDs
let idCounter = 0;

function generateUniqueId(prefix: string): string {
  const timestamp = Date.now();
  const counter = ++idCounter;
  return `${prefix}-${timestamp}-${counter}`;
}

// Default values for WorkflowSpec
const defaultWorkflowSpec: WorkflowSpec = {
  id: "test-workflow",
  name: "Test Workflow",
  version: 1,
  defaultBackend: "hermes" as BackendType,
  polling: {
    model: "claude-sonnet-4-6",
    timeoutSeconds: 300,
  },
  agents: [],
  steps: [],
  context: {},
  notifications: {},
};

// Default values for WorkflowAgent
const defaultWorkflowAgent: WorkflowAgent = {
  id: "test-agent",
  name: "Test Agent",
  description: "A test agent",
  role: "coding",
  model: "claude-sonnet-4-6",
  pollingModel: "claude-haiku-4-5",
  timeoutSeconds: 300,
  backend: "hermes",
  workspace: {
    baseDir: "/tmp/test-workspace",
    files: {},
  },
};

// Default values for WorkflowStep
const defaultWorkflowStep: WorkflowStep = {
  id: "test-step",
  agent: "test-agent",
  type: "single",
  input: "Test input prompt",
  expects: "Test expected output",
  max_retries: 3,
};

// Default values for Story
const defaultStory: Story = {
  id: generateUniqueId("story"),
  runId: "run-test-001",
  storyIndex: 0,
  storyId: "story-001",
  title: "Test Story",
  description: "A test story for development",
  acceptanceCriteria: ["Criterion 1", "Criterion 2"],
  status: "pending",
  output: undefined,
  retryCount: 0,
  maxRetries: 3,
};

// Default values for StepResult
const defaultStepResult: StepResult = {
  stepId: "test-step",
  agentId: "test-agent",
  output: "Test output",
  status: "done",
  completedAt: new Date().toISOString(),
};

// Default values for WorkflowRunRecord
const defaultWorkflowRunRecord: WorkflowRunRecord = {
  id: "run-test-001",
  workflowId: "test-workflow",
  workflowName: "Test Workflow",
  taskTitle: "Test Task",
  status: "running",
  leadAgentId: "test-agent",
  leadSessionLabel: "test-session",
  currentStepIndex: 0,
  currentStepId: "test-step",
  stepResults: [],
  retryCount: 0,
  context: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function buildWorkflowSpec(overrides?: Partial<WorkflowSpec>): WorkflowSpec {
  return {
    ...defaultWorkflowSpec,
    ...overrides,
    // Deep merge for nested objects to avoid mutation
    agents: overrides?.agents ?? [...defaultWorkflowSpec.agents],
    steps: overrides?.steps ?? [...defaultWorkflowSpec.steps],
    context: overrides?.context ?? { ...defaultWorkflowSpec.context },
    polling: overrides?.polling ?? { ...defaultWorkflowSpec.polling },
    notifications: overrides?.notifications ?? { ...defaultWorkflowSpec.notifications },
  };
}

export function buildWorkflowAgent(overrides?: Partial<WorkflowAgent>): WorkflowAgent {
  return {
    ...defaultWorkflowAgent,
    ...overrides,
    // Deep merge for nested workspace object
    workspace: overrides?.workspace ?? { ...defaultWorkflowAgent.workspace },
  };
}

export function buildWorkflowStep(overrides?: Partial<WorkflowStep>): WorkflowStep {
  return {
    ...defaultWorkflowStep,
    ...overrides,
    // Deep merge for nested on_fail object
    on_fail: overrides?.on_fail ?? defaultWorkflowStep.on_fail,
  };
}

export function buildStory(overrides?: Partial<Story>): Story {
  return {
    ...defaultStory,
    ...overrides,
    // Deep merge for arrays
    acceptanceCriteria: overrides?.acceptanceCriteria ?? [...defaultStory.acceptanceCriteria],
  };
}

export function buildRunRecord(overrides?: Partial<WorkflowRunRecord>): WorkflowRunRecord {
  const base = {
    ...defaultWorkflowRunRecord,
    ...overrides,
    // Deep merge for nested objects
    context: overrides?.context ?? { ...defaultWorkflowRunRecord.context },
  };

  // Handle stepResults array separately
  if (overrides?.stepResults !== undefined) {
    base.stepResults = overrides.stepResults;
  } else {
    base.stepResults = [...defaultWorkflowRunRecord.stepResults];
  }

  return base;
}

export interface BackendSpy extends Backend {
  installCalls: Array<{ workflow: WorkflowSpec; sourceDir: string }>;
  uninstallCalls: Array<{ workflowId: string }>;
  startRunCalls: Array<{ workflow: WorkflowSpec }>;
  stopRunCalls: Array<{ workflow: WorkflowSpec }>;
  configureAgentCalls: Array<{ workflow: WorkflowSpec; agent: WorkflowAgent }>;
  removeAgentCalls: Array<{ workflowId: string; agentId: string }>;
  validateCalls: Array<{ workflow: WorkflowSpec }>;
  reset: () => void;
}

export function buildBackendSpy(): BackendSpy {
  const spy: BackendSpy = {
    installCalls: [],
    uninstallCalls: [],
    startRunCalls: [],
    stopRunCalls: [],
    configureAgentCalls: [],
    removeAgentCalls: [],
    validateCalls: [],

    // Backend capabilities
    capabilities: {
      supportsPerToolDeny: true,
      supportsSandbox: false,
      schedulerDriven: false,
      supportsCronManagement: true,
    },

    // Permission adapter
    permissionAdapter: {
      async applyRoleConstraints(agent: WorkflowAgent): Promise<void> {
        // Spy implementation - no-op
      },
      async removeRoleConstraints(agentId: string): Promise<void> {
        // Spy implementation - no-op
      },
    },

    async install(workflow: WorkflowSpec, sourceDir: string): Promise<void> {
      spy.installCalls.push({ workflow, sourceDir });
    },

    async uninstall(workflowId: string): Promise<void> {
      spy.uninstallCalls.push({ workflowId });
    },

    async startRun(workflow: WorkflowSpec): Promise<void> {
      spy.startRunCalls.push({ workflow });
    },

    async stopRun(workflow: WorkflowSpec): Promise<void> {
      spy.stopRunCalls.push({ workflow });
    },

    async configureAgent(workflow: WorkflowSpec, agent: WorkflowAgent): Promise<void> {
      spy.configureAgentCalls.push({ workflow, agent });
    },

    async removeAgent(workflowId: string, agentId: string): Promise<void> {
      spy.removeAgentCalls.push({ workflowId, agentId });
    },

    async validate(workflow: WorkflowSpec): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
      spy.validateCalls.push({ workflow });
      return { valid: true, errors: [], warnings: [] };
    },

    reset(): void {
      spy.installCalls = [];
      spy.uninstallCalls = [];
      spy.startRunCalls = [];
      spy.stopRunCalls = [];
      spy.configureAgentCalls = [];
      spy.removeAgentCalls = [];
      spy.validateCalls = [];
    },
  };

  return spy;
}
