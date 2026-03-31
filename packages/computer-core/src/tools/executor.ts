/**
 * Tool executor interface used by the agent runner.
 *
 * Extracted from takos/packages/control/src/application/tools/executor.ts.
 */

import type { ToolCall, ToolResult, ToolDefinition } from './types.ts';
import type { ToolObserver } from '../memory-graph/types.ts';

export interface ToolExecutorLike {
  execute(toolCall: ToolCall): Promise<ToolResult>;
  getAvailableTools(): ToolDefinition[];
  readonly mcpFailedServers: string[];
  setObserver(observer: ToolObserver): void;
  cleanup(): void | Promise<void>;
}
