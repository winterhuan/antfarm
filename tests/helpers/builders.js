// Counter for generating unique IDs
let idCounter = 0;
function generateUniqueId(prefix) {
    const timestamp = Date.now();
    const counter = ++idCounter;
    return `${prefix}-${timestamp}-${counter}`;
}
// Default values for WorkflowSpec
const defaultWorkflowSpec = {
    id: "test-workflow",
    name: "Test Workflow",
    version: 1,
    defaultBackend: "hermes",
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
const defaultWorkflowAgent = {
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
const defaultWorkflowStep = {
    id: "test-step",
    agent: "test-agent",
    type: "single",
    input: "Test input prompt",
    expects: "Test expected output",
    max_retries: 3,
};
// Default values for Story
const defaultStory = {
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
const defaultStepResult = {
    stepId: "test-step",
    agentId: "test-agent",
    output: "Test output",
    status: "done",
    completedAt: new Date().toISOString(),
};
// Default values for WorkflowRunRecord
const defaultWorkflowRunRecord = {
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
export function buildWorkflowSpec(overrides) {
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
export function buildWorkflowAgent(overrides) {
    return {
        ...defaultWorkflowAgent,
        ...overrides,
        // Deep merge for nested workspace object
        workspace: overrides?.workspace ?? { ...defaultWorkflowAgent.workspace },
    };
}
export function buildWorkflowStep(overrides) {
    return {
        ...defaultWorkflowStep,
        ...overrides,
        // Deep merge for nested on_fail object
        on_fail: overrides?.on_fail ?? defaultWorkflowStep.on_fail,
    };
}
export function buildStory(overrides) {
    return {
        ...defaultStory,
        ...overrides,
        // Deep merge for arrays
        acceptanceCriteria: overrides?.acceptanceCriteria ?? [...defaultStory.acceptanceCriteria],
    };
}
export function buildRunRecord(overrides) {
    const base = {
        ...defaultWorkflowRunRecord,
        ...overrides,
        // Deep merge for nested objects
        context: overrides?.context ?? { ...defaultWorkflowRunRecord.context },
    };
    // Handle stepResults array separately
    if (overrides?.stepResults !== undefined) {
        base.stepResults = overrides.stepResults;
    }
    else {
        base.stepResults = [...defaultWorkflowRunRecord.stepResults];
    }
    return base;
}
export function buildBackendSpy() {
    const spy = {
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
            async applyRoleConstraints(agent) {
                // Spy implementation - no-op
            },
            async removeRoleConstraints(agentId) {
                // Spy implementation - no-op
            },
        },
        async install(workflow, sourceDir) {
            spy.installCalls.push({ workflow, sourceDir });
        },
        async uninstall(workflowId) {
            spy.uninstallCalls.push({ workflowId });
        },
        async startRun(workflow) {
            spy.startRunCalls.push({ workflow });
        },
        async stopRun(workflow) {
            spy.stopRunCalls.push({ workflow });
        },
        async configureAgent(workflow, agent) {
            spy.configureAgentCalls.push({ workflow, agent });
        },
        async removeAgent(workflowId, agentId) {
            spy.removeAgentCalls.push({ workflowId, agentId });
        },
        async validate(workflow) {
            spy.validateCalls.push({ workflow });
            return { valid: true, errors: [], warnings: [] };
        },
        reset() {
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
