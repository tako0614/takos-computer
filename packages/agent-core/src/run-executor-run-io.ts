/**
 * ControlRpc-based RunIo adapter.
 *
 * Bridges the ControlRpcClient into the RunIo interface expected by
 * the agent runner's executeRun function. Extracted from run-executor.ts
 * to keep the large type surface isolated.
 */

import type { ControlRpcClient } from './control-rpc.ts';

export function createControlRpcRunIo(
  controlRpc: ControlRpcClient,
): {
  getRunBootstrap: (input: {
    runId: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getRunBootstrap']>>>;
  getRunRecord: (input: {
    runId: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getRunRecord']>>>;
  getRunStatus: (input: {
    runId: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getRunStatus']>>>;
  getConversationHistory: (input: {
    runId: string;
    threadId: string;
    spaceId: string;
    aiModel: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getConversationHistory']>>>;
  resolveSkillPlan: (input: {
    runId: string;
    threadId: string;
    spaceId: string;
    agentType: string;
    history: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      tool_call_id?: string;
    }>;
    availableToolNames: string[];
  }) => Promise<Awaited<ReturnType<ControlRpcClient['resolveSkillPlan']>>>;
  getMemoryActivation: (input: {
    spaceId: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getMemoryActivation']>>>;
  finalizeMemoryOverlay: (input: {
    runId: string;
    spaceId: string;
    claims: Array<{
      id: string;
      accountId: string;
      claimType: 'fact' | 'preference' | 'decision' | 'observation';
      subject: string;
      predicate: string;
      object: string;
      confidence: number;
      status: 'active' | 'superseded' | 'retracted';
      supersededBy: string | null;
      sourceRunId: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    evidence: Array<{
      id: string;
      accountId: string;
      claimId: string;
      kind: 'supports' | 'contradicts' | 'context';
      sourceType: 'tool_result' | 'user_message' | 'agent_inference' | 'memory_recall';
      sourceRef: string | null;
      content: string;
      trust: number;
      taint: string | null;
      createdAt: string;
    }>;
  }) => Promise<void>;
  addMessage: (input: {
    runId: string;
    threadId: string;
    message: {
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      tool_call_id?: string;
    };
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  updateRunStatus: (input: {
    runId: string;
    status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    usage: { inputTokens: number; outputTokens: number };
    output?: string;
    error?: string;
  }) => Promise<void>;
  getCurrentSessionId: (input: { runId: string; spaceId: string }) => Promise<string | null>;
  isCancelled: (input: { runId: string }) => Promise<boolean>;
  getToolCatalog: (input: {
    runId: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getToolCatalog']>>>;
  executeTool: (input: {
    runId: string;
    toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };
  }) => Promise<Awaited<ReturnType<ControlRpcClient['executeTool']>>>;
  cleanupToolExecutor: (input: { runId: string }) => Promise<void>;
  emitRunEvent: (input: {
    runId: string;
    type: 'started' | 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'artifact' | 'completed' | 'error' | 'cancelled' | 'progress';
    data: Record<string, unknown>;
    sequence: number;
    skipDb?: boolean;
  }) => Promise<void>;
} {
  return {
    getRunBootstrap(input) {
      return controlRpc.getRunBootstrap(input.runId);
    },
    getRunRecord(input) {
      return controlRpc.getRunRecord(input.runId);
    },
    getRunStatus(input) {
      return controlRpc.getRunStatus(input.runId);
    },
    getConversationHistory(input) {
      return controlRpc.getConversationHistory(input);
    },
    resolveSkillPlan(input) {
      return controlRpc.resolveSkillPlan(input);
    },
    getMemoryActivation(input) {
      return controlRpc.getMemoryActivation(input);
    },
    finalizeMemoryOverlay(input) {
      return controlRpc.finalizeMemoryOverlay(input);
    },
    addMessage(input) {
      return controlRpc.addMessage(input);
    },
    updateRunStatus(input) {
      return controlRpc.updateRunStatus(input);
    },
    getCurrentSessionId(input) {
      return controlRpc.getCurrentSessionId(input);
    },
    isCancelled(input) {
      return controlRpc.isCancelled(input.runId);
    },
    getToolCatalog(input) {
      return controlRpc.getToolCatalog(input.runId);
    },
    executeTool(input) {
      return controlRpc.executeTool(input);
    },
    cleanupToolExecutor(input) {
      return controlRpc.cleanupToolExecutor(input.runId);
    },
    emitRunEvent(input) {
      return controlRpc.emitRunEvent(input);
    },
  };
}
