/**
 * Agent Runner Engine — Execution engine dispatching.
 *
 * Contains the logic for running the agent with LangGraph, the simple
 * loop, or the no-LLM fallback, plus the top-level engine dispatcher.
 */

import type { RunStatus, Env } from '../../shared/types';
import type { SqlDatabaseBinding } from '../../shared/types/bindings';
import type { AgentContext, AgentConfig, AgentEvent, AgentMessage } from './types';
import type { ToolExecutorLike } from '../../tools/executor';
import type { LLMClient, ModelProvider } from './llm';
import type { SkillCatalogEntry, SkillSelection, SkillContext } from './skills';
import type { ToolExecution } from './runner-types';
import type { RunTerminalPayload } from '../../run-notifier-types';
import type { AgentMemoryRuntime } from '../../memory-graph/runtime';
import { runLangGraphRunner } from './langgraph-runner';
import { runWithSimpleLoop, runWithoutLLM } from './simple-loop';
import { AuthenticationError, InternalError } from '../../shared/utils/error-response';

// ── Shared deps passed from AgentRunner ──────────────────────────────

export interface EngineState {
  env: Env;
  db: SqlDatabaseBinding;
  context: AgentContext;
  config: AgentConfig;
  aiModel: string;
  modelProvider: ModelProvider;
  openAiKey: string | undefined;
  llmClient: LLMClient | undefined;
  toolExecutor: ToolExecutorLike | undefined;
  skillLocale: 'ja' | 'en';
  availableSkills: SkillCatalogEntry[];
  selectedSkills: SkillSelection[];
  activatedSkills: SkillContext[];
  toolExecutions: ToolExecution[];
  totalUsage: { inputTokens: number; outputTokens: number };
  toolCallCount: number;
  totalToolCalls: number;
  abortSignal?: AbortSignal;
  memoryRuntime?: AgentMemoryRuntime;
}

export interface EngineDeps {
  throwIfCancelled: (ctx: string) => Promise<void>;
  checkCancellation: (force?: boolean) => Promise<boolean>;
  emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>;
  addMessage: (msg: AgentMessage, meta?: Record<string, unknown>) => Promise<void>;
  updateRunStatus: (status: RunStatus, output?: string, error?: string) => Promise<void>;
  buildTerminalEventPayload: (
    status: 'completed' | 'failed' | 'cancelled',
    details?: Record<string, unknown>,
  ) => RunTerminalPayload;
  getConversationHistory: () => Promise<AgentMessage[]>;
}

// ── LangGraph execution ──────────────────────────────────────────────

export async function runWithLangGraph(
  state: EngineState,
  deps: EngineDeps,
  history: AgentMessage[],
): Promise<void> {
  if (!state.openAiKey) {
    throw new AuthenticationError('API key is required for LangGraph');
  }
  if (!state.toolExecutor) {
    throw new InternalError('Tool executor not initialized');
  }
  await runLangGraphRunner({
    apiKey: state.openAiKey,
    model: state.aiModel,
    systemPrompt: state.config.systemPrompt,
    skillPlan: {
      locale: state.skillLocale,
      availableSkills: state.availableSkills,
      selectableSkills: state.availableSkills.filter((skill) => skill.availability !== 'unavailable'),
      selectedSkills: state.selectedSkills,
      activatedSkills: state.activatedSkills,
    },
    history,
    threadId: state.context.threadId,
    runId: state.context.runId,
    sessionId: state.context.sessionId,
    toolExecutor: state.toolExecutor as never,
    db: state.db,
    maxIterations: state.config.maxIterations || 10,
    temperature: state.config.temperature ?? 0.7,
    toolExecutions: state.toolExecutions,
    emitEvent: deps.emitEvent,
    addMessage: deps.addMessage,
    updateRunStatus: deps.updateRunStatus,
    env: state.env,
    spaceId: state.context.spaceId,
    shouldCancel: deps.checkCancellation,
    abortSignal: state.abortSignal,
    memoryRuntime: state.memoryRuntime ?? undefined,
  });
}

// ── Simple loop execution ────────────────────────────────────────────

export async function runSimpleLoop(
  state: EngineState,
  deps: EngineDeps,
): Promise<void> {
  if (!state.llmClient) {
    throw new InternalError('No LLM client available');
  }
  await runWithSimpleLoop({
    env: state.env,
    config: state.config,
    llmClient: state.llmClient,
    toolExecutor: state.toolExecutor,
    skillLocale: state.skillLocale,
    availableSkills: state.availableSkills,
    selectedSkills: state.selectedSkills,
    activatedSkills: state.activatedSkills,
    spaceId: state.context.spaceId,
    abortSignal: state.abortSignal,
    toolExecutions: state.toolExecutions,
    totalUsage: state.totalUsage,
    toolCallCount: state.toolCallCount,
    totalToolCalls: state.totalToolCalls,
    memoryRuntime: state.memoryRuntime ?? undefined,
    throwIfCancelled: deps.throwIfCancelled,
    emitEvent: deps.emitEvent,
    addMessage: deps.addMessage,
    updateRunStatus: deps.updateRunStatus,
    buildTerminalEventPayload: deps.buildTerminalEventPayload,
    getConversationHistory: deps.getConversationHistory,
  });
}

// ── Engine dispatcher ────────────────────────────────────────────────

export async function executeRunEngine(
  state: EngineState,
  deps: EngineDeps,
  history: AgentMessage[],
  engine: 'langgraph' | 'simple' | 'none',
): Promise<void> {
  if (engine === 'none') {
    await runWithoutLLM(
      {
        toolExecutor: state.toolExecutor,
        emitEvent: deps.emitEvent,
        addMessage: deps.addMessage,
        updateRunStatus: deps.updateRunStatus,
        buildTerminalEventPayload: deps.buildTerminalEventPayload,
      },
      history,
    );
    return;
  }

  if (engine === 'simple') {
    await deps.emitEvent('thinking', {
      message: 'Using simple mode for selected model',
      engine: 'simple',
    });
    await runSimpleLoop(state, deps);
    return;
  }

  await runWithLangGraph(state, deps, history);
}
