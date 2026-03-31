/**
 * Helper utilities for the run executor.
 *
 * Pure functions for no-LLM fallback, environment building, status fetching,
 * and failure handling. Extracted from run-executor.ts.
 */

import type { ControlRpcClient } from './control-rpc.ts';
import type {
  StartPayload,
  RunStatus,
  RunExecutorRuntimeConfig,
  RunExecutorExecutionEnv,
  ExecutorLogger,
} from './run-executor-types.ts';

// ---------------------------------------------------------------------------
// No-LLM fallback
// ---------------------------------------------------------------------------

function buildNoLlmFallbackResponse(query: string): string {
  return `I understand you're asking about: "${query}"\n\n`
    + `I'm an AI agent that can help you with:\n`
    + `- Reading and writing files\n`
    + `- Searching your workspace\n`
    + `- Deploying workers\n`
    + `- Running build commands\n`
    + `- Working with repositories and containers\n`
    + `- Remembering information\n`
    + `- Creating code and documentation\n\n`
    + `Try asking me to "list files" or "read file 'path/to/file'".\n\n`
    + `Note: LLM API key not configured. Running in limited mode.`;
}

export async function runNoLlmFastPath(
  controlRpc: ControlRpcClient,
  payload: Pick<StartPayload, 'runId' | 'workerId' | 'serviceId'>,
  logger: ExecutorLogger,
  tag: string,
): Promise<void> {
  const context = await controlRpc.getRunContext(payload.runId);
  const query = context.lastUserMessage || 'No message provided';
  const response = buildNoLlmFallbackResponse(query);
  logger.info(`[${tag}] Completing run ${payload.runId} via no-LLM fast path`);
  await controlRpc.completeNoLlmRun({
    runId: payload.runId,
    serviceId: payload.serviceId ?? payload.workerId,
    workerId: payload.workerId,
    response,
  });
}

export function isNoLlmFallbackAllowed(runtimeConfig?: RunExecutorRuntimeConfig): boolean {
  return runtimeConfig?.allowNoLlmFallback === true;
}

// ---------------------------------------------------------------------------
// Environment building
// ---------------------------------------------------------------------------

export function buildCanonicalRemoteExecutionEnv(apiKeys: {
  openai?: string;
  anthropic?: string;
  google?: string;
}, executionEnv?: RunExecutorExecutionEnv): Record<string, unknown> {
  return {
    OPENAI_API_KEY: apiKeys.openai,
    ANTHROPIC_API_KEY: apiKeys.anthropic,
    GOOGLE_API_KEY: apiKeys.google,
    ADMIN_DOMAIN: executionEnv?.ADMIN_DOMAIN,
    TENANT_BASE_DOMAIN: executionEnv?.TENANT_BASE_DOMAIN,
    MAX_AGENT_ITERATIONS: executionEnv?.MAX_AGENT_ITERATIONS,
    AGENT_TEMPERATURE: executionEnv?.AGENT_TEMPERATURE,
    AGENT_RATE_LIMIT: executionEnv?.AGENT_RATE_LIMIT,
    AGENT_ITERATION_TIMEOUT: executionEnv?.AGENT_ITERATION_TIMEOUT ?? '120000',
    AGENT_TOTAL_TIMEOUT: executionEnv?.AGENT_TOTAL_TIMEOUT ?? '86400000',
    TOOL_EXECUTION_TIMEOUT: executionEnv?.TOOL_EXECUTION_TIMEOUT ?? '300000',
    LANGGRAPH_TIMEOUT: executionEnv?.LANGGRAPH_TIMEOUT ?? '86400000',
    SERPER_API_KEY: executionEnv?.SERPER_API_KEY,
  };
}

// ---------------------------------------------------------------------------
// Status & failure helpers
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchCurrentRunStatus(
  controlRpc: ControlRpcClient,
  runId: string,
  logger: ExecutorLogger,
  tag: string,
): Promise<RunStatus | null> {
  try {
    const status = await controlRpc.getRunStatus(runId);

    return status === 'pending'
      || status === 'queued'
      || status === 'running'
      || status === 'completed'
      || status === 'failed'
      || status === 'cancelled'
      ? status
      : null;
  } catch (statusError) {
    logger.error(`[${tag}] Failed to load run status for ${runId}`, { error: statusError });
    return null;
  }
}

export async function markRunFailedFromExecutor(
  controlRpc: ControlRpcClient,
  payload: {
    runId: string;
    serviceId?: string;
    workerId?: string;
    leaseVersion?: number;
    error: string;
  },
  logger: ExecutorLogger,
  tag: string,
): Promise<void> {
  try {
    await controlRpc.failRun(payload);
  } catch (markErr) {
    logger.error(`[${tag}] Failed to mark run ${payload.runId} as failed after heartbeat loss`, { error: markErr });
  }
}

/** Fetch API keys from the gateway Worker proxy (keys never travel in the dispatch payload). */
export async function fetchApiKeys(controlRpc: ControlRpcClient): Promise<{
  openai?: string;
  anthropic?: string;
  google?: string;
}> {
  return controlRpc.fetchApiKeys();
}
