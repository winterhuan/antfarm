// Nominal typing for primitives - prevents accidental mixing
export type Brand<T, B extends string> = T & { readonly __brand: B };

// Branded ID types
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type StepId = Brand<string, 'StepId'>;
export type RunId = Brand<string, 'RunId'>;
export type AgentId = Brand<string, 'AgentId'>;

// Smart constructors with validation
export function workflowId(id: string): WorkflowId {
  if (!id || typeof id !== 'string') {
    throw new Error('WorkflowId must be a non-empty string');
  }
  return id as WorkflowId;
}

export function stepId(id: string): StepId {
  if (!id || typeof id !== 'string') {
    throw new Error('StepId must be a non-empty string');
  }
  return id as StepId;
}

export function runId(id: string): RunId {
  if (!id || typeof id !== 'string') {
    throw new Error('RunId must be a non-empty string');
  }
  return id as RunId;
}

export function agentId(id: string): AgentId {
  if (!id || typeof id !== 'string') {
    throw new Error('AgentId must be a non-empty string');
  }
  return id as AgentId;
}
