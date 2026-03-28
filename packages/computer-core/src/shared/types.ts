/**
 * Shared types extracted from takos/packages/control/src/shared/types.
 *
 * Only the types actually consumed by the agent runner are included.
 */

// From queue-messages.ts
export const INDEX_QUEUE_MESSAGE_VERSION = 1;

export interface IndexJobQueueMessage {
  version: typeof INDEX_QUEUE_MESSAGE_VERSION;
  jobId: string;
  spaceId: string;
  type: 'full' | 'file' | 'vectorize' | 'info_unit' | 'thread_context' | 'repo_code_index' | 'memory_build_paths';
  targetId?: string;
  repoId?: string;
  timestamp: number;
}

// From models.ts
export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

// NOTE: MessageRole — intentionally duplicated from @takos/control shared/types/models.ts.
// takos-computer is a separate repository (git submodule) and cannot import from @takos/control.
// Canonical definition: takos/packages/control/src/shared/types/models.ts
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

// NOTE: Agent RunStatus — intentionally duplicated from @takos/control shared/types/models.ts.
// takos-computer is a separate repository (git submodule) and cannot import from @takos/control.
// Canonical definition: takos/packages/control/src/shared/types/models.ts
// See also: takos/packages/agent-core/src/run-executor.ts (another copy).
//
// This is NOT the same as the GitHub Actions RunStatus ('queued'|'in_progress'|'completed'|'cancelled')
// defined in takos/packages/actions-engine/src/types.ts — those are different domain concepts.
export type RunStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DbEnv {
  DB: import('./types/bindings').SqlDatabaseBinding;
}

export interface AiEnv {
  VECTORIZE?: import('./types/bindings').VectorIndexBinding;
  AI?: import('./types/bindings').AiBinding;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  SERPER_API_KEY?: string;
}

/**
 * Env interface — minimal subset consumed by the agent runner.
 *
 * In the original control package this is a large union of all Cloudflare bindings.
 * Here we keep only the fields that appear in the copied agent code.
 */
export interface Env {
  DB: import('./types/bindings').SqlDatabaseBinding;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  SERPER_API_KEY?: string;
  AI?: import('./types/bindings').AiBinding;
  VECTORIZE?: import('./types/bindings').VectorIndexBinding;
  TAKOS_OFFLOAD?: import('./types/bindings').ObjectStoreBinding;
  GIT_OBJECTS?: import('./types/bindings').ObjectStoreBinding;
  RUNTIME_HOST?: { fetch(request: Request): Promise<Response> };
  EXECUTOR_HOST?: { fetch(request: Request): Promise<Response> };
  BROWSER_HOST?: { fetch(request: Request): Promise<Response> };
  RUN_NOTIFIER?: import('./types/bindings').DurableNamespaceBinding;
  RUN_QUEUE?: import('./types/bindings').QueueBinding;
  INDEX_QUEUE?: import('./types/bindings').QueueBinding;
  MAX_AGENT_ITERATIONS?: string;
  AGENT_TEMPERATURE?: string;
  AGENT_RATE_LIMIT?: string;
  AGENT_ITERATION_TIMEOUT?: string;
  AGENT_TOTAL_TIMEOUT?: string;
  TOOL_EXECUTION_TIMEOUT?: string;
  LANGGRAPH_TIMEOUT?: string;
  /** JSON object mapping model IDs to context window sizes, e.g. {"gpt-5.4":200} */
  MODEL_CONTEXT_WINDOWS?: string;
  TAKOS_OFFLOAD_ENABLED?: string;
  [key: string]: unknown;
}
