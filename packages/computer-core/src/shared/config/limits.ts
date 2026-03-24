/**
 * System limits used by the agent runner.
 */

export const MAX_TOTAL_TOOL_CALLS_PER_RUN = 1000;
export const MAX_TOOL_EXECUTIONS_HISTORY = 50;
export const MAX_EVENT_EMISSION_ERRORS = 20;
export const THREAD_RETRIEVAL_TOP_K = 10;
export const THREAD_RETRIEVAL_MIN_SCORE = 0.5;
export const THREAD_CONTEXT_MAX_CHARS = 8000;
export const MAX_TOOL_OUTPUT_SIZE = 10 * 1024 * 1024;
export const MAX_PARALLEL_TOOL_EXECUTIONS = 5;
