/**
 * AgentRunnerIo — IO boundary interface for the Agent Runner.
 *
 * Defines all side-effectful operations the runner delegates to its host
 * environment (DB queries, tool execution, event emission, etc.).
 */

import type { RunStatus } from '../../shared/types';
import type { AgentMessage } from './types';
import type { SkillLoadResult } from './skills';

export interface AgentRunnerIo {
  getRunBootstrap(input: {
    runId: string;
  }): Promise<{
    status: RunStatus | null;
    spaceId: string;
    sessionId: string | null;
    threadId: string;
    userId: string;
    agentType: string;
  }>;
  getRunRecord(input: {
    runId: string;
  }): Promise<{
    status: RunStatus | null;
    input: string | null;
    parentRunId: string | null;
  }>;
  getRunStatus(input: { runId: string }): Promise<RunStatus | null>;
  getConversationHistory(input: {
    runId: string;
    threadId: string;
    spaceId: string;
    aiModel: string;
  }): Promise<AgentMessage[]>;
  addMessage(input: {
    runId: string;
    threadId: string;
    message: AgentMessage;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  updateRunStatus(input: {
    runId: string;
    status: RunStatus;
    usage: { inputTokens: number; outputTokens: number };
    output?: string;
    error?: string;
  }): Promise<void>;
  getCurrentSessionId(input: { runId: string; spaceId: string }): Promise<string | null>;
  isCancelled(input: { runId: string }): Promise<boolean>;
  resolveSkillPlan(input: {
    runId: string;
    threadId: string;
    spaceId: string;
    agentType: string;
    history: AgentMessage[];
    availableToolNames: string[];
  }): Promise<SkillLoadResult>;
  getMemoryActivation(input: { spaceId: string }): Promise<import('../../memory-graph/types').ActivationResult>;
  finalizeMemoryOverlay(input: {
    runId: string;
    spaceId: string;
    claims: import('../../memory-graph/types').Claim[];
    evidence: import('../../memory-graph/types').Evidence[];
  }): Promise<void>;
  getToolCatalog(input: { runId: string }): Promise<{
    tools: import('../../tools/types').ToolDefinition[];
    mcpFailedServers: string[];
  }>;
  executeTool(input: {
    runId: string;
    toolCall: import('../../tools/types').ToolCall;
  }): Promise<import('../../tools/types').ToolResult>;
  cleanupToolExecutor(input: { runId: string }): Promise<void>;
  emitRunEvent(input: {
    runId: string;
    type: import('./types').AgentEvent['type'];
    data: Record<string, unknown>;
    sequence: number;
    skipDb?: boolean;
  }): Promise<void>;
}
