/**
 * Agent Runner Setup — Tool initialization and run preparation logic.
 *
 * Extracted from runner.ts to keep the main class focused on orchestration.
 */

import type { RunStatus, Env } from '../../shared/types.ts';
import type { SqlDatabaseBinding } from '../../shared/types/bindings.ts';
import type { AgentContext, AgentConfig, AgentEvent, AgentMessage, ToolCall } from './types.ts';
import type { ToolExecutorLike } from '../../tools/executor.ts';
import type { ToolDefinition } from '../../tools/types.ts';
import type { Claim, Evidence } from '../../memory-graph/types.ts';
import type { AgentRunnerIo } from './runner-io.ts';
import type { SkillCatalogEntry, SkillSelection, SkillContext } from './skills.ts';
import { emitSkillLoadOutcome } from './skills.ts';
import { buildToolCatalogContent } from './prompts.ts';
import { buildBudgetedSystemPrompt, LANE_PRIORITY, LANE_MAX_TOKENS, type PromptLane } from './prompt-budget.ts';
import { RemoteToolExecutor } from './remote-tool-executor.ts';
import { AgentMemoryRuntime } from '../../memory-graph/runtime.ts';
import type { AgentMemoryBackend } from '../../memory-graph/runtime.ts';
import { safeJsonParseOrDefault } from '../../shared/utils.ts';
import { logWarn } from '../../shared/utils/logger.ts';
import { getDelegationPacketFromRunInput } from './delegation.ts';

// ── Shared state bucket passed from AgentRunner ──────────────────────

export interface RunnerState {
  env: Env;
  db: SqlDatabaseBinding;
  context: AgentContext;
  config: AgentConfig;
  aiModel: string;
  modelProvider: import('./llm.ts').ModelProvider;
  openAiKey: string | undefined;
  llmClient: import('./llm.ts').LLMClient | undefined;
  toolExecutor: ToolExecutorLike | undefined;
  skillLocale: 'ja' | 'en';
  availableSkills: SkillCatalogEntry[];
  selectedSkills: SkillSelection[];
  activatedSkills: SkillContext[];
  memoryRuntime?: AgentMemoryRuntime;
  runIo: AgentRunnerIo;
}

// ── Tool executor initialization ─────────────────────────────────────

export async function initToolExecutor(
  state: RunnerState,
  emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  state.toolExecutor = await RemoteToolExecutor.create(state.context.runId, {
    getToolCatalog: (input: { runId: string }) => state.runIo.getToolCatalog(input),
    executeTool: (input: { runId: string; toolCall: ToolCall }) => state.runIo.executeTool(input),
    cleanupToolExecutor: (input: { runId: string }) => state.runIo.cleanupToolExecutor(input),
  });

  const availableTools: ToolDefinition[] = state.toolExecutor.getAvailableTools();
  state.config.tools = availableTools.map((tool: ToolDefinition) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  const toolCatalog = buildToolCatalogContent(
    availableTools.map((tool: ToolDefinition) => ({
      name: tool.name,
      description: tool.description,
    })),
  );

  const lanes: PromptLane[] = [
    {
      priority: LANE_PRIORITY.BASE_PROMPT,
      name: 'base',
      content: state.config.systemPrompt,
      maxTokens: LANE_MAX_TOKENS.BASE_PROMPT,
    },
    {
      priority: LANE_PRIORITY.TOOL_CATALOG,
      name: 'tools',
      content: toolCatalog,
      maxTokens: LANE_MAX_TOKENS.TOOL_CATALOG,
    },
  ];

  state.config.systemPrompt = buildBudgetedSystemPrompt(lanes);

  const failedMcp = state.toolExecutor.mcpFailedServers;
  if (failedMcp.length > 0) {
    await emitEvent('thinking', {
      message: `Warning: Failed to load MCP servers: ${failedMcp.join(', ')}`,
      warning: true,
      failed_mcp_servers: failedMcp,
    });
  }
}

// ── Memory backend factory ───────────────────────────────────────────

export function createMemoryBackend(state: RunnerState): AgentMemoryBackend {
  return {
    bootstrap: () => state.runIo.getMemoryActivation({ spaceId: state.context.spaceId }),
    finalize: ({ claims, evidence }: { claims: Claim[]; evidence: Evidence[] }) => state.runIo.finalizeMemoryOverlay({
      runId: state.context.runId,
      spaceId: state.context.spaceId,
      claims,
      evidence,
    }),
  };
}

// ── Run preparation ──────────────────────────────────────────────────

export async function prepareRunExecution(
  state: RunnerState,
  deps: {
    throwIfCancelled: (ctx: string) => Promise<void>;
    updateRunStatus: (status: RunStatus, output?: string, error?: string) => Promise<void>;
    emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>;
    getConversationHistory: () => Promise<AgentMessage[]>;
    getRunRecord: () => Promise<{ status: RunStatus | null; input: string | null; parentRunId: string | null }>;
    resolveSkillPlan: (history: AgentMessage[]) => Promise<import('./skills.ts').SkillLoadResult>;
  },
): Promise<{
  engine: 'langgraph' | 'simple' | 'none';
  history: AgentMessage[];
}> {
  await deps.throwIfCancelled('before-start');
  const canUseLangGraph = state.modelProvider === 'openai'
    && !!state.openAiKey;
  const engine = !state.llmClient
    ? 'none'
    : canUseLangGraph
      ? 'langgraph'
      : 'simple';

  await deps.updateRunStatus('running');
  await deps.emitEvent('started', {
    agent_type: state.config.type,
    engine,
  });

  if (!state.llmClient) {
    await deps.emitEvent('thinking', {
      message: `Warning: No API key configured for ${state.modelProvider} (model: ${state.aiModel}). Running in limited mode without LLM.`,
      warning: true,
    });
  }

  await initToolExecutor(state, deps.emitEvent);

  const history = await deps.getConversationHistory();
  if (!state.llmClient) {
    await deps.throwIfCancelled('before-execution');
    return { engine, history };
  }

  const currentRun = await deps.getRunRecord();
  const runInput = safeJsonParseOrDefault<Record<string, unknown> | unknown>(currentRun.input || '{}', {});
  const runInputObject = runInput && typeof runInput === 'object' && !Array.isArray(runInput)
    ? runInput as Record<string, unknown>
    : {};
  const delegationPacket = currentRun.parentRunId
    ? getDelegationPacketFromRunInput(runInputObject)
    : null;
  const delegationObservability = runInputObject.delegation_observability;
  const savedDelegationObservability = delegationObservability && typeof delegationObservability === 'object' && !Array.isArray(delegationObservability)
    ? delegationObservability as Record<string, unknown>
    : null;
  if (delegationPacket) {
    await deps.emitEvent('thinking', {
      message: 'Loaded delegated execution context for sub-agent run',
      delegated_context: true,
      delegation_product_hint: delegationPacket.product_hint,
      delegation_locale: delegationPacket.locale,
      delegation_constraints_count: delegationPacket.constraints.length,
      delegation_context_count: delegationPacket.context.length,
      delegation_has_thread_summary: !!delegationPacket.thread_summary,
      delegation_explicit_fields_count: typeof savedDelegationObservability?.explicit_field_count === 'number'
        ? savedDelegationObservability.explicit_field_count
        : null,
      delegation_inferred_fields_count: typeof savedDelegationObservability?.inferred_field_count === 'number'
        ? savedDelegationObservability.inferred_field_count
        : null,
    });
  }
  const skillResult = await deps.resolveSkillPlan(history);

  state.skillLocale = skillResult.skillLocale;
  state.availableSkills = skillResult.availableSkills;
  state.selectedSkills = skillResult.selectedSkills;
  state.activatedSkills = skillResult.activatedSkills;

  await emitSkillLoadOutcome(skillResult, deps.emitEvent);

  // Initialize memory runtime and wire observer + idempotency into tool executor
  try {
    state.memoryRuntime = new AgentMemoryRuntime(
      state.db,
      state.context,
      state.env,
      createMemoryBackend(state),
    );
    await state.memoryRuntime.bootstrap();
    if (state.toolExecutor) {
      const observer = state.memoryRuntime.createToolObserver();
      state.toolExecutor.setObserver(observer);
    }
  } catch (err) {
    logWarn('Memory runtime initialization failed, continuing without memory', {
      module: 'services/agent/runner',
      detail: err,
    });
    state.memoryRuntime = undefined;
  }

  await deps.throwIfCancelled('before-execution');

  return { engine, history };
}
