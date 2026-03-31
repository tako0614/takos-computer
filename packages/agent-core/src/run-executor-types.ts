/**
 * Type definitions and constants for the run executor.
 *
 * Extracted from run-executor.ts to keep each module focused and under 400 lines.
 */

// ---------------------------------------------------------------------------
// --- Run lifecycle types ---
// ---------------------------------------------------------------------------

export type RunStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Whether the run should be reset to queued when the container/executor encounters
 * an error. Only resets if the run is still in 'running' status — terminal states
 * (completed, failed, cancelled) are preserved.
 */
export function shouldResetRunToQueuedOnContainerError(
  status: RunStatus | null | undefined,
): boolean {
  return status === 'running';
}

/**
 * Function signature for the agent runner's `executeRun`.
 * Used for dependency injection — callers pass the concrete implementation
 * (resolved from @takos/control-agent at build time) into agent-core's executor.
 */
export type ExecuteRunFn = (
  env: Record<string, unknown>,
  apiKey: string | undefined,
  runId: string,
  model: string | undefined,
  options: {
    abortSignal?: AbortSignal;
    runIo: unknown;
  },
) => Promise<void>;

// ---------------------------------------------------------------------------

export interface StartPayload {
  runId: string;
  serviceId?: string;
  workerId: string;
  model?: string;
  leaseVersion?: number;
  controlRpcToken?: string;
  controlRpcBaseUrl?: string;
  /** Signal from the server's graceful shutdown — aborts this run early. */
  shutdownSignal?: AbortSignal;
}

export interface RunExecutorOptions {
  /** Service name for log messages (e.g., 'takos-executor', 'private-runner') */
  serviceName: string;
  /** Logger instance */
  logger: ExecutorLogger;
  /**
   * Maximum consecutive heartbeat failures before marking run as failed.
   * Default: 10 (10 minutes). External/private runners may want higher values.
   */
  maxHeartbeatFailures?: number;
  /**
   * The agent runner's executeRun function.
   * Injected by the caller so that agent-core does not depend on takos-control internals.
   */
  executeRun: ExecuteRunFn;
  /**
   * Runtime-supplied execution config. Host entry points assemble this from
   * their environment so the shared executor does not read Deno.env.
   */
  runtimeConfig?: RunExecutorRuntimeConfig;
}

export interface ExecutorLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface RunExecutorExecutionEnv {
  ADMIN_DOMAIN?: string;
  TENANT_BASE_DOMAIN?: string;
  MAX_AGENT_ITERATIONS?: string;
  AGENT_TEMPERATURE?: string;
  AGENT_RATE_LIMIT?: string;
  AGENT_ITERATION_TIMEOUT?: string;
  AGENT_TOTAL_TIMEOUT?: string;
  TOOL_EXECUTION_TIMEOUT?: string;
  LANGGRAPH_TIMEOUT?: string;
  SERPER_API_KEY?: string;
}

export interface RunExecutorRuntimeConfig {
  controlRpcBaseUrl?: string;
  allowNoLlmFallback?: boolean;
  maxRunDurationMs?: number;
  executionEnv?: RunExecutorExecutionEnv;
}

// ---------------------------------------------------------------------------
// --- Constants ---
// ---------------------------------------------------------------------------

export const HEARTBEAT_INTERVAL_MS = 60_000;
export const DEFAULT_MAX_HEARTBEAT_FAILURES = 10;
export const HEARTBEAT_TIMEOUT_MS = 15_000;
export const ABORT_SETTLE_GRACE_MS = 5_000;
