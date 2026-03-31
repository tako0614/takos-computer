/**
 * Stub for builtin tools.
 *
 * In the original control package this contains the full tool catalog.
 * The agent runner only uses BUILTIN_TOOLS to provide a default tool list
 * for getAgentConfig. The real tools come from the remote tool executor.
 */

import type { ToolDefinition } from './types.ts';

/** Default empty list — tools are loaded at runtime via the tool executor. */
export const BUILTIN_TOOLS: ToolDefinition[] = [];
