/**
 * Type definitions and constants for the delegation coordinator.
 *
 * Shared across the delegation-coordinator and delegation modules.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single task to be delegated to a sub-agent. */
export interface DelegationTask {
  /** Clear, self-contained instructions for the sub-agent. */
  task: string;
  /** Higher-level goal for the delegated work. */
  goal?: string;
  /** Expected output or artifact. */
  deliverable?: string;
  /** Constraints the sub-agent must respect. */
  constraints?: string[];
  /** Relevant findings or facts to pass to the sub-agent. */
  context?: string[];
  /** Checks the delegated result should satisfy. */
  acceptanceCriteria?: string[];
  /** Product hint (e.g. `'takos'`, `'yurucommu'`, `'roadtome'`). */
  productHint?: string;
  /** Preferred locale for the delegated work. */
  locale?: string;
  /** Agent type for the sub-agent (default: `'default'`). */
  agentType?: string;
  /** LLM model override for the sub-agent. */
  model?: string;
}

/** Input to the delegation coordinator. */
export interface DelegationInput {
  /** Tasks to delegate. */
  tasks: DelegationTask[];
  /** Execution strategy. */
  strategy: 'parallel' | 'sequential' | 'fan-out';
  /** Run ID of the parent agent. */
  parentRunId: string;
  /** Thread ID of the parent agent. */
  parentThreadId: string;
  /** Root thread ID (top of the delegation chain). */
  rootThreadId: string;
  /** Optional timeout in milliseconds for each task wait. */
  timeoutMs?: number;
}

/** Result for a single delegated task. */
export interface DelegationTaskResult {
  /** Original task description. */
  task: string;
  /** Run ID of the spawned sub-agent. */
  runId: string;
  /** Terminal status of the sub-agent run. */
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  /** Output from the sub-agent (if completed). */
  output?: string;
  /** Error message (if failed). */
  error?: string;
  /** Wall-clock duration in milliseconds. */
  duration: number;
}

/** Aggregated output from the delegation coordinator. */
export interface DelegationOutput {
  /** Per-task results in the same order as the input tasks. */
  results: DelegationTaskResult[];
  /** Total wall-clock duration of the entire delegation. */
  totalDuration: number;
  /** Number of tasks that completed successfully. */
  successCount: number;
  /** Number of tasks that failed, were cancelled, or timed out. */
  failureCount: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Tracks a spawned sub-agent. */
export interface SpawnedTask {
  taskIndex: number;
  task: DelegationTask;
  runId: string;
  childThreadId: string;
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_WAIT_TIMEOUT_MS = 60_000;
export const MAX_WAIT_TIMEOUT_MS = 300_000;
export const WAIT_POLL_INTERVAL_MS = 1_500;

export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
