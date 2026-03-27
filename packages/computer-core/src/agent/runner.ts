/**
 * Agent Runner — orchestrates agent run execution.
 *
 * Heavy logic is split into sibling modules:
 *   runner-io / runner-setup / runner-engine / runner-events /
 *   runner-messages / runner-types / session-closer / skills /
 *   simple-loop / execute-run
 */

import type { RunStatus, Env } from '../../shared/types';
import type { ObjectStoreBinding, SqlDatabaseBinding } from '../../shared/types/bindings';
import type { AgentContext, AgentConfig, AgentEvent, AgentMessage } from './types';
import type { ToolExecutorLike } from '../../tools/executor';
import { LLMClient, createLLMClient, getProviderFromModel, type ModelProvider } from './llm';
import { RunCancelledError } from './run-lifecycle';
import type { SkillCatalogEntry, SkillSelection, SkillContext } from './skills';
import { getAgentConfig } from './runner-config';
import { DEFAULT_MODEL_ID } from './model-catalog';
import type { RunTerminalPayload } from '../../run-notifier-types';
import { logError, logWarn } from '../../shared/utils/logger';
import { AppError } from '../../shared/utils/error-response';
import {
  handleSuccessfulRunCompletion,
  handleCancelledRun,
  handleFailedRun,
  type RunLifecycleDeps,
} from './run-lifecycle';

// Extracted modules
import type { ToolExecution } from './runner-types';
import { sanitizeErrorMessage, enqueuePostRunJobs } from './runner-types';
import { autoCloseSession as autoCloseSessionImpl } from './session-closer';
import type { AgentMemoryRuntime } from '../../memory-graph/runtime';

export type { AgentRunnerIo } from './runner-io';
export { executeRun } from './execute-run';

import { type EventEmitterState, createEventEmitterState, emitEventImpl, buildTerminalEventPayloadImpl } from './runner-events';
import { normalizeRunStatus } from './runner-messages';
import type { AgentRunnerIo } from './runner-io';
import { prepareRunExecution } from './runner-setup';
import { executeRunEngine } from './runner-engine';

// ── AgentRunner class ──────────────────────────────────────────────

export class AgentRunner {
  private db: SqlDatabaseBinding;
  private env: Env;
  private openAiKey: string | undefined;
  private anthropicKey: string | undefined;
  private googleKey: string | undefined;
  private llmClient: LLMClient | undefined;
  private context: AgentContext;
  private config: AgentConfig;
  private toolExecutor: ToolExecutorLike | undefined;
  private totalUsage = { inputTokens: 0, outputTokens: 0 };
  private availableSkills: SkillCatalogEntry[] = [];
  private selectedSkills: SkillSelection[] = [];
  private activatedSkills: SkillContext[] = [];
  private skillLocale: 'ja' | 'en' = 'en';
  private aiModel: string;
  private modelProvider: ModelProvider;
  private abortSignal?: AbortSignal;
  private toolCallCount = 0;
  private totalToolCalls = 0;
  private lastCancelCheck = 0;
  private isCancelled = false;
  private static readonly CANCEL_CHECK_INTERVAL_MS = 2000;

  private toolExecutions: ToolExecution[] = [];
  private eventState: EventEmitterState;
  private memoryRuntime?: AgentMemoryRuntime;
  private runIo: AgentRunnerIo;

  constructor(
    env: Env,
    db: SqlDatabaseBinding,
    _storage: ObjectStoreBinding | undefined,
    apiKey: string | undefined,
    context: AgentContext,
    agentType: string,
    aiModel: string = DEFAULT_MODEL_ID,
    options: {
      abortSignal?: AbortSignal;
      runIo: AgentRunnerIo;
    },
  ) {
    this.env = env;
    this.db = db;
    this.context = context;
    this.config = getAgentConfig(agentType, env);
    this.aiModel = aiModel;
    this.modelProvider = getProviderFromModel(aiModel);
    this.abortSignal = options.abortSignal;
    this.runIo = options.runIo;
    this.eventState = createEventEmitterState();

    this.openAiKey = apiKey || env.OPENAI_API_KEY;
    this.anthropicKey = env.ANTHROPIC_API_KEY;
    this.googleKey = env.GOOGLE_API_KEY;

    const providerKeyMap: Record<ModelProvider, string | undefined> = {
      openai: this.openAiKey,
      anthropic: this.anthropicKey,
      google: this.googleKey,
    };
    const providerKey = providerKeyMap[this.modelProvider];

    if (providerKey) {
      this.llmClient = createLLMClient(providerKey, {
        model: aiModel,
        anthropicApiKey: this.anthropicKey,
        googleApiKey: this.googleKey,
      });
    }
  }

  // ── Bound delegates ────────────────────────────────────────────────

  private async emitEvent(
    type: AgentEvent['type'],
    data: Record<string, unknown>,
    options?: { skipDb?: boolean },
  ): Promise<void> {
    return emitEventImpl(
      this.eventState,
      this.env,
      this.db,
      this.context.runId,
      this.context.spaceId,
      () => this.getCurrentSessionId(),
      type,
      data,
      options,
      (input) => this.runIo.emitRunEvent(input),
    );
  }

  private async updateRunStatus(
    status: RunStatus,
    output?: string,
    error?: string,
  ): Promise<void> {
    return this.runIo.updateRunStatus({
      runId: this.context.runId,
      status,
      usage: this.totalUsage,
      output,
      error,
    });
  }

  private buildTerminalEventPayload(
    status: 'completed' | 'failed' | 'cancelled',
    details: Record<string, unknown> = {},
  ): RunTerminalPayload {
    return buildTerminalEventPayloadImpl(
      this.context.runId,
      status,
      details,
      this.context.sessionId ?? null,
    );
  }

  private async autoCloseSession(status: 'completed' | 'failed'): Promise<void> {
    return autoCloseSessionImpl(
      {
        env: this.env,
        db: this.db,
        context: this.context,
        checkCancellation: (force) => this.checkCancellation(force),
        emitEvent: (type, data) => this.emitEvent(type, data),
        getCurrentSessionId: () => this.getCurrentSessionId(),
      },
      status,
    );
  }

  // ── Cancellation checks ───────────────────────────────────────────

  private async checkCancellation(force = false): Promise<boolean> {
    if (this.abortSignal?.aborted) {
      return false;
    }

    const now = Date.now();
    if (!force && now - this.lastCancelCheck < AgentRunner.CANCEL_CHECK_INTERVAL_MS) {
      return this.isCancelled;
    }

    this.isCancelled = await this.runIo.isCancelled({ runId: this.context.runId });
    this.lastCancelCheck = now;
    return this.isCancelled;
  }

  private async throwIfCancelled(ctx: string): Promise<void> {
    if (this.abortSignal?.aborted) {
      const reason = this.abortSignal.reason;
      const message = reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Run aborted';
      throw new AppError(`${message} (${ctx})`);
    }

    if (await this.checkCancellation()) {
      throw new RunCancelledError(`Run cancelled (${ctx})`);
    }
  }

  // ── Queue jobs ────────────────────────────────────────────────────

  private async enqueuePostRunJobs(): Promise<void> {
    await enqueuePostRunJobs(this.env, this.context.spaceId, this.context.runId, this.context.threadId);
  }

  // ── Conversation / message helpers ────────────────────────────────

  private async getConversationHistory(): Promise<AgentMessage[]> {
    return this.runIo.getConversationHistory({
      runId: this.context.runId,
      threadId: this.context.threadId,
      spaceId: this.context.spaceId,
      aiModel: this.aiModel,
    });
  }

  private async addMessage(message: AgentMessage, metadata?: Record<string, unknown>): Promise<void> {
    return this.runIo.addMessage({
      runId: this.context.runId,
      threadId: this.context.threadId,
      message,
      metadata,
    });
  }

  private async getCurrentSessionId(): Promise<string | null> {
    return this.runIo.getCurrentSessionId({
      runId: this.context.runId,
      spaceId: this.context.spaceId,
    });
  }

  private async getRunRecord(): Promise<{
    status: RunStatus | null;
    input: string | null;
    parentRunId: string | null;
  }> {
    return this.runIo.getRunRecord({ runId: this.context.runId });
  }

  private async resolveSkillPlan(history: AgentMessage[]): Promise<import('./skills').SkillLoadResult> {
    return this.runIo.resolveSkillPlan({
      runId: this.context.runId,
      threadId: this.context.threadId,
      spaceId: this.context.spaceId,
      agentType: this.config.type,
      history,
      availableToolNames: this.toolExecutor?.getAvailableTools().map((tool) => tool.name) ?? [],
    });
  }

  // ── Lifecycle delegation ──────────────────────────────────────────

  private lifecycleDeps(): RunLifecycleDeps {
    return {
      updateRunStatus: this.updateRunStatus.bind(this),
      emitEvent: this.emitEvent.bind(this),
      buildTerminalEventPayload: this.buildTerminalEventPayload.bind(this),
      autoCloseSession: this.autoCloseSession.bind(this),
      enqueuePostRunJobs: this.enqueuePostRunJobs.bind(this),
      sanitizeErrorMessage,
    };
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  private async cleanupAfterRun(): Promise<void> {
    try {
      const executor = this.toolExecutor;

      // Finalize memory runtime (flush overlay claims to DB)
      if (this.memoryRuntime) {
        try {
          await this.memoryRuntime.finalize();
        } catch (err) {
          logWarn('Memory runtime finalize failed during cleanup', {
            module: 'services/agent/runner',
            detail: err,
          });
        }
        this.memoryRuntime = undefined;
      }

      this.toolExecutor = undefined;
      await executor?.cleanup();
      this.toolExecutions.length = 0;

      const currentRunStatus = await this.runIo.getRunStatus({ runId: this.context.runId });

      if (normalizeRunStatus(currentRunStatus) === 'running') {
        logWarn(`Run ${this.context.runId} was left in running state - marking as failed`, { module: 'agentrunner' });
        await this.updateRunStatus('failed', undefined, 'Run terminated unexpectedly during cleanup');
      }
    } catch (cleanupError) {
      logError('Cleanup error', cleanupError, { module: 'services/agent/runner' });
    }
  }

  // ── Bridging helpers for extracted modules ──────────────────────────

  /** Mutable state snapshot consumed by prepareRunExecution */
  private buildSetupState() {
    return {
      env: this.env, db: this.db, context: this.context, config: this.config,
      aiModel: this.aiModel, modelProvider: this.modelProvider,
      openAiKey: this.openAiKey, llmClient: this.llmClient,
      toolExecutor: this.toolExecutor, skillLocale: this.skillLocale,
      availableSkills: this.availableSkills, selectedSkills: this.selectedSkills,
      activatedSkills: this.activatedSkills, memoryRuntime: this.memoryRuntime,
      runIo: this.runIo,
    };
  }

  /** Sync mutated fields back from setup state */
  private applySetupState(s: ReturnType<AgentRunner['buildSetupState']>): void {
    this.toolExecutor = s.toolExecutor;
    this.skillLocale = s.skillLocale;
    this.availableSkills = s.availableSkills;
    this.selectedSkills = s.selectedSkills;
    this.activatedSkills = s.activatedSkills;
    this.memoryRuntime = s.memoryRuntime;
  }

  /** Read-only snapshot consumed by executeRunEngine */
  private buildEngineState() {
    return {
      env: this.env, db: this.db, context: this.context, config: this.config,
      aiModel: this.aiModel, modelProvider: this.modelProvider,
      openAiKey: this.openAiKey, llmClient: this.llmClient,
      toolExecutor: this.toolExecutor, skillLocale: this.skillLocale,
      availableSkills: this.availableSkills, selectedSkills: this.selectedSkills,
      activatedSkills: this.activatedSkills, toolExecutions: this.toolExecutions,
      totalUsage: this.totalUsage, toolCallCount: this.toolCallCount,
      totalToolCalls: this.totalToolCalls, abortSignal: this.abortSignal,
      memoryRuntime: this.memoryRuntime,
    };
  }

  // ── Main entry point ──────────────────────────────────────────────

  async run(): Promise<void> {
    const boundDeps = {
      throwIfCancelled: (ctx: string) => this.throwIfCancelled(ctx),
      checkCancellation: (force?: boolean) => this.checkCancellation(force),
      emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) =>
        this.emitEvent(type, data),
      addMessage: (msg: AgentMessage, meta?: Record<string, unknown>) =>
        this.addMessage(msg, meta),
      updateRunStatus: (status: RunStatus, output?: string, error?: string) =>
        this.updateRunStatus(status, output, error),
      buildTerminalEventPayload: (
        status: 'completed' | 'failed' | 'cancelled',
        details?: Record<string, unknown>,
      ) => this.buildTerminalEventPayload(status, details),
      getConversationHistory: () => this.getConversationHistory(),
      getRunRecord: () => this.getRunRecord(),
      resolveSkillPlan: (h: AgentMessage[]) => this.resolveSkillPlan(h),
    };

    try {
      const setupState = this.buildSetupState();
      const { engine, history } = await prepareRunExecution(setupState, boundDeps);
      this.applySetupState(setupState);

      await executeRunEngine(this.buildEngineState(), boundDeps, history, engine);
      await handleSuccessfulRunCompletion(this.lifecycleDeps());
    } catch (error) {
      if (error instanceof RunCancelledError) {
        await handleCancelledRun(this.lifecycleDeps());
        return;
      }
      await handleFailedRun(this.lifecycleDeps(), error);
      throw error;
    } finally {
      await this.cleanupAfterRun();
    }
  }
}
