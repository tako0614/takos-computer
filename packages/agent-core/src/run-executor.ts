/**
 * Shared run executor for canonical Control RPC based execution.
 *
 * Used by both takos-executor (container) and private runner integrations.
 * The concrete executeRun implementation is injected via RunExecutorOptions
 * so that this package does not depend on takos-control internals.
 *
 * This is the main entry point. Internal logic is split across:
 * - run-executor-types.ts   — type definitions, interfaces, constants
 * - run-executor-helpers.ts  — pure utility functions
 * - run-executor-run-io.ts   — ControlRpc RunIo adapter
 */

import { ControlRpcClient, createStaticControlRpcTokenSource } from './control-rpc.js';
import { createControlRpcRunIo } from './run-executor-run-io.js';
import {
  runNoLlmFastPath,
  isNoLlmFallbackAllowed,
  buildCanonicalRemoteExecutionEnv,
  sleep,
  fetchCurrentRunStatus,
  markRunFailedFromExecutor,
  fetchApiKeys,
} from './run-executor-helpers.js';
import {
  DEFAULT_MAX_HEARTBEAT_FAILURES,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  ABORT_SETTLE_GRACE_MS,
  shouldResetRunToQueuedOnContainerError,
} from './run-executor-types.js';
import type {
  StartPayload,
  RunExecutorOptions,
} from './run-executor-types.js';

// ---------------------------------------------------------------------------
// Re-export all public types and utilities from sub-modules so that existing
// consumers of './run-executor.js' continue to work without changes.
// ---------------------------------------------------------------------------
export type {
  RunStatus,
  ExecuteRunFn,
  StartPayload,
  RunExecutorOptions,
  ExecutorLogger,
  RunExecutorExecutionEnv,
  RunExecutorRuntimeConfig,
} from './run-executor-types.js';
export { shouldResetRunToQueuedOnContainerError } from './run-executor-types.js';

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

/**
 * Execute a run with the given payload and options.
 * Runs asynchronously (fire-and-forget from the caller's perspective).
 *
 * Canonical path:
 * - Control RPC for lifecycle/state/tool execution
 * - Remote tool execution from the host side
 */
export async function executeRunInContainer(
  payload: StartPayload,
  options: RunExecutorOptions,
): Promise<void> {
  const { runId, workerId, model, leaseVersion } = payload;
  const serviceId = payload.serviceId ?? workerId;
  const { serviceName, logger } = options;
  const maxHeartbeatFailures = options.maxHeartbeatFailures ?? DEFAULT_MAX_HEARTBEAT_FAILURES;
  const runtimeConfig = options.runtimeConfig;
  const tag = serviceName;

  const controlToken = payload.controlRpcToken;
  if (!controlToken) {
    throw new Error(`[${tag}] Missing control RPC token for run ${runId}`);
  }
  const controlRpcBaseUrl = runtimeConfig?.controlRpcBaseUrl || payload.controlRpcBaseUrl;
  if (!controlRpcBaseUrl) {
    throw new Error(`[${tag}] Missing CONTROL_RPC_BASE_URL for run ${runId}`);
  }

  const controlRpc = new ControlRpcClient(
    controlRpcBaseUrl,
    runId,
    createStaticControlRpcTokenSource(controlToken),
  );
  const runIo = createControlRpcRunIo(controlRpc);

  // Derive run duration limit from the same env var used by AgentRunner
  const maxRunDurationMs = runtimeConfig?.maxRunDurationMs
    ?? parseInt(runtimeConfig?.executionEnv?.AGENT_TOTAL_TIMEOUT ?? '86400000', 10);

  // Fetch API keys from gateway — fail fast if proxy is unreachable
  let apiKeys: { openai?: string; anthropic?: string; google?: string };
  try {
    apiKeys = await fetchApiKeys(controlRpc);
  } catch (err) {
    logger.error(`[${tag}] Failed to fetch API keys for run ${runId}, aborting`, { error: err });
    try {
      await controlRpc.resetRun({ runId, serviceId, workerId });
    } catch { /* best-effort */ }
    throw err;
  }

  // Verify at least one LLM key is available
  if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.google) {
    if (isNoLlmFallbackAllowed(runtimeConfig)) {
      logger.warn(`[${tag}] No LLM API keys available for run ${runId}; continuing in no-LLM mode`);
      await runNoLlmFastPath(controlRpc, { runId, serviceId, workerId }, logger, tag);
      return;
    } else {
    const msg = `No LLM API keys available for run ${runId}`;
    logger.error(`[${tag}] ${msg}`);
    try {
      await controlRpc.resetRun({ runId, serviceId, workerId });
    } catch { /* best-effort */ }
    throw new Error(msg);
    }
  }

  const fakeEnv = buildCanonicalRemoteExecutionEnv(apiKeys, runtimeConfig?.executionEnv);

  // AbortController for timeout — shared by heartbeat and run
  const abortController = new AbortController();

  // If the server is shutting down, propagate abort to this run
  if (payload.shutdownSignal) {
    if (payload.shutdownSignal.aborted) {
      abortController.abort(payload.shutdownSignal.reason);
    } else {
      payload.shutdownSignal.addEventListener('abort', () => {
        abortController.abort(payload.shutdownSignal!.reason ?? new Error('Server shutdown'));
      }, { once: true });
    }
  }

  // Heartbeat: update workerHeartbeat every 60s to prevent stale detection
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let consecutiveFailures = 0;
  let nextLogAt = 1; // Exponential backoff: log at 1, 2, 4, 8...
  let runPromise: Promise<void> | null = null;

  function clearHeartbeat(): void {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  heartbeatInterval = setInterval(async () => {
    // Stop sending heartbeats if run was aborted
    if (abortController.signal.aborted) {
      clearHeartbeat();
      return;
    }

    try {
      await controlRpc.heartbeat({ runId, serviceId, workerId, leaseVersion }, HEARTBEAT_TIMEOUT_MS);
      consecutiveFailures = 0;
      nextLogAt = 1;
    } catch (err) {
      // Check if this is a 409 Conflict (lease lost)
      const is409 = err instanceof Error && (err.message.includes('409') || err.message.includes('Lease lost'));
      if (is409) {
        logger.error(`[${tag}] Lease lost for run ${runId}, aborting`);
        clearHeartbeat();
        abortController.abort(new Error('Lease lost'));
        return;
      }
      consecutiveFailures++;
      // Log with exponential backoff: log at 1, 2, 4, 8... consecutive failures
      if (consecutiveFailures >= nextLogAt || consecutiveFailures >= maxHeartbeatFailures) {
        logger.error(`[${tag}] Heartbeat failed for run ${runId} (${consecutiveFailures}/${maxHeartbeatFailures})`, { error: err });
        nextLogAt = Math.min(nextLogAt * 2, maxHeartbeatFailures);
      }
      if (consecutiveFailures >= maxHeartbeatFailures) {
        logger.error(`[${tag}] Too many heartbeat failures for run ${runId}, marking as failed`);
        clearHeartbeat();
        await markRunFailedFromExecutor(controlRpc, {
          runId,
          serviceId,
          workerId,
          leaseVersion,
          error: 'Heartbeat lost — executor marked run as failed',
        }, logger, tag);
        // Abort the run so it doesn't keep executing
        abortController.abort(new Error('Heartbeat lost'));
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    runPromise = options.executeRun(
      fakeEnv,
      apiKeys.openai,
      runId,
      model,
      { abortSignal: abortController.signal, runIo },
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        // Abort immediately — stops heartbeat and signals run to stop
        abortController.abort(new Error('Timeout'));
        reject(new Error(`Run ${runId} exceeded maximum duration of ${maxRunDurationMs}ms`));
      }, maxRunDurationMs);
      timer.unref();

      // Also abort on signal (e.g., heartbeat failure)
      abortController.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(abortController.signal.reason ?? new Error('Run aborted'));
      }, { once: true });
    });

    await Promise.race([runPromise, timeoutPromise]);

    // Record billing via proxy after run completes
    try {
      await controlRpc.recordBillingUsage(runId);
    } catch (err) {
      logger.error(`[${tag}] Billing recording failed for run ${runId}`, { error: err });
    }
  } catch (err) {
    logger.error(`[${tag}] Run ${runId} failed`, { error: err });

    // Wait for the aborting AgentRunner to settle before checking status
    if (abortController.signal.aborted && runPromise) {
      await Promise.race([
        runPromise.catch(() => {}),
        sleep(ABORT_SETTLE_GRACE_MS),
      ]);
    }

    const currentStatus = await fetchCurrentRunStatus(controlRpc, runId, logger, tag);
    if (!shouldResetRunToQueuedOnContainerError(currentStatus)) {
      logger.warn(
        `[${tag}] Preserving run ${runId} status ${currentStatus ?? 'unknown'} after error`,
      );
      return;
    }

    // Reset only non-terminal runs for stale recovery.
    try {
      await controlRpc.resetRun({ runId, serviceId, workerId });
    } catch (resetErr) {
      logger.error(`[${tag}] Failed to reset run ${runId}`, { error: resetErr });
    }
  } finally {
    // Always clear heartbeat and abort controller
    clearHeartbeat();
    if (!abortController.signal.aborted) {
      abortController.abort(new Error('Run finished'));
    }
  }
}
