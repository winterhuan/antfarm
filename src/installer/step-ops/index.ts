/**
 * Step Operations Barrel Export
 *
 * Zero-breakage migration path for step-ops.ts decomposition.
 * Re-exports all step operations from focused modules.
 *
 * @deprecated The original src/installer/step-ops.ts is deprecated.
 * Use imports from this index or specific modules instead.
 */

// Parser module
export {
  parseOutputKeyValues,
  parseAndInsertStories,
  getStories,
  getCurrentStory,
  formatStoryForTemplate,
  formatCompletedStories,
} from "../step-parser.js";

// Template module
export {
  resolveTemplate,
  findMissingTemplateKeys,
  computeHasFrontendChanges,
} from "../step-template.js";

// Lifecycle module
export {
  peekStep,
  claimStep,
  completeStep,
  failStep,
  advancePipeline,
  cleanupAbandonedSteps,
} from "../step-lifecycle.js";
export type {
  PeekResult,
  ClaimResult,
  CompleteResult,
  FailResult,
} from "../step-lifecycle.js";

// Loop module
export {
  handleVerifyEachCompletion,
  checkLoopContinuation,
  shouldRetryStory,
  processStoryRetries,
} from "../step-loop.js";
export type {
  LoopResult,
} from "../step-loop.js";

// Utils module
export {
  getWorkflowId,
  scheduleRunCronTeardown,
  getAgentWorkspacePath,
  readProgressFile,
  archiveRunProgress,
  escalation,
} from "../step-utils.js";
export type {
  ProgressData,
} from "../step-utils.js";
