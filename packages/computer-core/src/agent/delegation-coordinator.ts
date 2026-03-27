/**
 * Delegation Coordinator — Multi-agent worker for sub-agent orchestration.
 *
 * Extends {@link AbstractAgentWorker} to provide a higher-level abstraction
 * over the raw `spawn_agent` / `wait_agent` tool handlers. Supports three
 * delegation strategies:
 *
 * - **parallel**: Spawn all sub-agents first, then wait for all results.
 * - **sequential**: Spawn and wait for each task one at a time.
 * - **fan-out**: Spawn all sub-agents without waiting (fire-and-forget).
 *
 * The coordinator tracks per-task timing and aggregates results into a
 * typed {@link DelegationOutput}.
 *
 * This module also contains the spawn/wait operations and strategy
 * implementations (parallel, sequential, fan-out) that were previously
 * split across delegation-operations.ts and delegation-strategies.ts.
 */

import { AbstractAgentWorker } from '../../multi-agent/base-worker';
import type {
  AgentWorkerConfig,
  AgentMessage as CoordinatorMessage,
} from '../../multi-agent/types';
import type { Env } from '../../shared/types';
import type { D1Database } from '../../shared/types/bindings';
import { logInfo, logWarn } from '../../shared/utils/logger';

import {
  buildDelegationPacket,
} from './delegation';
import { createThreadRun, type CreateThreadRunResult } from '../../execution/run-creation';
import { createThread, updateThreadStatus } from '../../threads/threads';
import { resolveRunModel } from '../../runs/create-thread-run-validation';

// Re-export public types so existing consumers keep working
export type {
  DelegationTask,
  DelegationInput,
  DelegationTaskResult,
  DelegationOutput,
} from './delegation-types';

import type {
  DelegationTask,
  DelegationInput,
  DelegationTaskResult,
  DelegationOutput,
  SpawnedTask,
} from './delegation-types';

import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
  WAIT_POLL_INTERVAL_MS,
  TERMINAL_STATUSES,
} from './delegation-types';

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

/** Runtime context required by spawn/wait operations. */
export interface DelegationContext {
  env: Env;
  db: D1Database;
  userId: string;
  spaceId: string;
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

/**
 * Spawn a single sub-agent task.
 *
 * Builds a delegation packet, creates a child thread, and enqueues a
 * run via {@link createThreadRun}.
 */
async function spawnTask(
  ctx: DelegationContext,
  task: DelegationTask,
  input: DelegationInput,
): Promise<SpawnedTask> {
  const startedAt = Date.now();
  const agentType = task.agentType || 'default';
  const model = await resolveRunModel(ctx.db, ctx.spaceId, task.model);

  const { packet, observability } = buildDelegationPacket({
    task: task.task,
    goal: task.goal ?? null,
    deliverable: task.deliverable ?? null,
    constraints: task.constraints,
    context: task.context,
    acceptanceCriteria: task.acceptanceCriteria,
    productHint: task.productHint ?? null,
    locale: task.locale ?? null,
    parentRunId: input.parentRunId,
    parentThreadId: input.parentThreadId,
    rootThreadId: input.rootThreadId,
  });

  // Create child thread
  const childThread = await createThread(ctx.db, ctx.spaceId, {
    title: `Sub-agent: ${task.task.trim().slice(0, 80)}`,
    locale: packet.locale,
  });

  if (!childThread) {
    throw new Error('Failed to create child thread for sub-agent');
  }

  // Create run
  const spawnResult: CreateThreadRunResult = await createThreadRun(ctx.env, {
    userId: ctx.userId,
    threadId: childThread.id,
    agentType,
    input: {
      task: task.task,
      goal: packet.goal,
      deliverable: packet.deliverable,
      locale: packet.locale,
      product_hint: packet.product_hint,
      delegation: packet,
      delegation_observability: observability,
    },
    parentRunId: input.parentRunId,
    model,
  });

  if (!spawnResult.ok) {
    // Clean up orphaned thread
    try {
      await updateThreadStatus(ctx.db, childThread.id, 'archived');
    } catch (archiveErr) {
      logWarn(`Failed to archive orphan child thread ${childThread.id}`, {
        module: 'delegation-coordinator',
        detail: archiveErr,
      });
    }
    throw new Error(`Failed to spawn sub-agent: ${'error' in spawnResult ? spawnResult.error : 'unknown error'}`);
  }

  if (!spawnResult.run) {
    throw new Error('Sub-agent run record was not created');
  }

  const taskIndex = input.tasks.indexOf(task);

  logInfo(`Spawned sub-agent for task ${taskIndex} (run: ${spawnResult.run.id})`, {
    module: 'delegation-coordinator',
  });

  return {
    taskIndex,
    task,
    runId: spawnResult.run.id,
    childThreadId: childThread.id,
    startedAt,
  };
}

// ---------------------------------------------------------------------------
// Wait
// ---------------------------------------------------------------------------

/**
 * Wait for a sub-agent run to reach a terminal status.
 *
 * Polls the run status at regular intervals until the run completes,
 * fails, is cancelled, or the timeout expires.
 */
async function waitForTask(
  ctx: DelegationContext,
  runId: string,
  taskDescription: string,
  startedAt: number,
  timeoutMs?: number,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<DelegationTaskResult> {
  if (!runId) {
    return {
      task: taskDescription,
      runId: '',
      status: 'failed',
      error: 'No run ID to wait on',
      duration: Date.now() - startedAt,
    };
  }

  const effectiveTimeout = Math.min(
    timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
    MAX_WAIT_TIMEOUT_MS,
  );
  const deadline = Date.now() + effectiveTimeout;

  // Import DB utilities lazily to avoid circular deps
  const { getDb, runs } = await import('../../infra/db');
  const { eq } = await import('drizzle-orm');

  const db = getDb(ctx.db);

  while (Date.now() < deadline) {
    const row = await db
      .select({
        status: runs.status,
        output: runs.output,
        error: runs.error,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();

    if (!row) {
      return {
        task: taskDescription,
        runId,
        status: 'failed',
        error: `Run ${runId} not found`,
        duration: Date.now() - startedAt,
      };
    }

    if (TERMINAL_STATUSES.has(row.status)) {
      const mappedStatus = row.status as 'completed' | 'failed' | 'cancelled';
      return {
        task: taskDescription,
        runId,
        status: mappedStatus,
        output: row.output ?? undefined,
        error: row.error ?? undefined,
        duration: Date.now() - startedAt,
      };
    }

    // Wait before next poll
    await sleepFn(Math.min(WAIT_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }

  // Timeout
  logWarn(`Wait for run ${runId} timed out after ${effectiveTimeout}ms`, {
    module: 'delegation-coordinator',
  });

  return {
    task: taskDescription,
    runId,
    status: 'timeout',
    error: `Timed out after ${effectiveTimeout}ms`,
    duration: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Strategy helpers
// ---------------------------------------------------------------------------

/**
 * Runtime helpers injected by the coordinator so strategy functions can
 * reuse the base-class `sleep`, `executeWithRetry`, and `throwIfAborted`.
 */
interface StrategyHelpers {
  sleepFn: (ms: number) => Promise<void>;
  retryFn: <T>(fn: () => Promise<T>) => Promise<T>;
  throwIfAborted: (signal?: AbortSignal) => void;
}

// ---------------------------------------------------------------------------
// Parallel strategy
// ---------------------------------------------------------------------------

/**
 * Parallel strategy: spawn all tasks first, then wait for all.
 */
async function executeParallel(
  ctx: DelegationContext,
  input: DelegationInput,
  helpers: StrategyHelpers,
  signal?: AbortSignal,
): Promise<DelegationTaskResult[]> {
  // Spawn all
  const spawned: SpawnedTask[] = [];
  for (let i = 0; i < input.tasks.length; i++) {
    helpers.throwIfAborted(signal);
    const task = input.tasks[i];
    try {
      const sp = await helpers.retryFn(
        () => spawnTask(ctx, task, input),
      );
      spawned.push(sp);
    } catch (err) {
      spawned.push({
        taskIndex: i,
        task,
        runId: '',
        childThreadId: '',
        startedAt: Date.now(),
      });
      logWarn(`Failed to spawn task ${i}: ${err instanceof Error ? err.message : String(err)}`, {
        module: 'delegation-coordinator',
      });
    }
  }

  // Wait for all in parallel
  const waitPromises = spawned.map((sp) => {
    if (!sp.runId) {
      // Spawn failed — immediate failure result
      return Promise.resolve<DelegationTaskResult>({
        task: sp.task.task,
        runId: '',
        status: 'failed',
        error: 'Failed to spawn sub-agent',
        duration: Date.now() - sp.startedAt,
      });
    }
    return waitForTask(ctx, sp.runId, sp.task.task, sp.startedAt, input.timeoutMs, helpers.sleepFn);
  });

  const settled = await Promise.allSettled(waitPromises);
  return settled.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      task: spawned[i].task.task,
      runId: spawned[i].runId,
      status: 'failed' as const,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      duration: Date.now() - spawned[i].startedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Sequential strategy
// ---------------------------------------------------------------------------

/**
 * Sequential strategy: spawn and wait for each task one at a time.
 */
async function executeSequential(
  ctx: DelegationContext,
  input: DelegationInput,
  helpers: StrategyHelpers,
  signal?: AbortSignal,
): Promise<DelegationTaskResult[]> {
  const results: DelegationTaskResult[] = [];

  for (const task of input.tasks) {
    helpers.throwIfAborted(signal);

    try {
      const spawned = await helpers.retryFn(
        () => spawnTask(ctx, task, input),
      );
      const result = await waitForTask(
        ctx,
        spawned.runId,
        task.task,
        spawned.startedAt,
        input.timeoutMs,
        helpers.sleepFn,
      );
      results.push(result);
    } catch (err) {
      results.push({
        task: task.task,
        runId: '',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        duration: 0,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Fan-out strategy
// ---------------------------------------------------------------------------

/**
 * Fan-out strategy: spawn all tasks without waiting for results.
 */
async function executeFanOut(
  ctx: DelegationContext,
  input: DelegationInput,
  helpers: StrategyHelpers,
  signal?: AbortSignal,
): Promise<DelegationTaskResult[]> {
  const results: DelegationTaskResult[] = [];

  for (const task of input.tasks) {
    helpers.throwIfAborted(signal);

    try {
      const spawned = await helpers.retryFn(
        () => spawnTask(ctx, task, input),
      );
      results.push({
        task: task.task,
        runId: spawned.runId,
        status: 'completed',
        output: `Sub-agent spawned (run_id: ${spawned.runId})`,
        duration: Date.now() - spawned.startedAt,
      });
    } catch (err) {
      results.push({
        task: task.task,
        runId: '',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        duration: 0,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// DelegationCoordinator
// ---------------------------------------------------------------------------

/**
 * Coordinates delegation of multiple tasks to sub-agents.
 *
 * Requires an {@link Env} binding (for DB and queue access) and a
 * `userId` / `spaceId` pair to be set before execution via
 * {@link setContext}.
 */
export class DelegationCoordinator extends AbstractAgentWorker<DelegationInput, DelegationOutput> {
  private env: Env | null = null;
  private db: D1Database | null = null;
  private userId: string | null = null;
  private spaceId: string | null = null;

  constructor(id?: string) {
    super('delegation-coordinator', id);
  }

  /**
   * Set the runtime context required for spawning sub-agents.
   *
   * Must be called before {@link execute}.
   */
  setContext(env: Env, db: D1Database, userId: string, spaceId: string): void {
    this.env = env;
    this.db = db;
    this.userId = userId;
    this.spaceId = spaceId;
  }

  // ── Lifecycle hooks ────────────────────────────────────────────────

  protected async onInitialize(_config: AgentWorkerConfig): Promise<void> {
    // No special initialization required
  }

  protected async onExecute(
    input: DelegationInput,
    signal?: AbortSignal,
  ): Promise<DelegationOutput> {
    this.assertContext();

    const ctx = this.buildContext();
    const helpers = this.buildHelpers();
    const overallStart = Date.now();

    let results: DelegationTaskResult[];

    switch (input.strategy) {
      case 'parallel':
        results = await executeParallel(ctx, input, helpers, signal);
        break;
      case 'sequential':
        results = await executeSequential(ctx, input, helpers, signal);
        break;
      case 'fan-out':
        results = await executeFanOut(ctx, input, helpers, signal);
        break;
      default:
        throw new Error(`Unknown delegation strategy: ${input.strategy}`);
    }

    const totalDuration = Date.now() - overallStart;
    const successCount = results.filter((r) => r.status === 'completed').length;
    const failureCount = results.length - successCount;

    logInfo(
      `Delegation completed: ${successCount}/${results.length} succeeded (${input.strategy})`,
      { module: 'delegation-coordinator' },
    );

    return {
      results,
      totalDuration,
      successCount,
      failureCount,
    };
  }

  protected async onMessage(message: CoordinatorMessage): Promise<unknown> {
    this.assertContext();

    const ctx = this.buildContext();

    switch (message.type) {
      case 'spawn-task': {
        const payload = message.payload as { task: DelegationTask; input: DelegationInput };
        const spawned = await spawnTask(ctx, payload.task, payload.input);
        return { runId: spawned.runId, childThreadId: spawned.childThreadId };
      }

      case 'wait-task': {
        const payload = message.payload as {
          runId: string;
          task: string;
          startedAt: number;
          timeoutMs?: number;
        };
        return waitForTask(
          ctx,
          payload.runId,
          payload.task,
          payload.startedAt,
          payload.timeoutMs,
          this.sleep.bind(this),
        );
      }

      case 'spawn-and-wait': {
        const payload = message.payload as { task: DelegationTask; input: DelegationInput };
        const spawned = await spawnTask(ctx, payload.task, payload.input);
        return waitForTask(
          ctx,
          spawned.runId,
          payload.task.task,
          spawned.startedAt,
          payload.input.timeoutMs,
          this.sleep.bind(this),
        );
      }

      default:
        return super.onMessage(message);
    }
  }

  protected async onShutdown(): Promise<void> {
    this.env = null;
    this.db = null;
    this.userId = null;
    this.spaceId = null;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /** Assert that {@link setContext} has been called. */
  private assertContext(): void {
    if (!this.env || !this.db || !this.userId || !this.spaceId) {
      throw new Error(
        'DelegationCoordinator requires setContext(env, db, userId, spaceId) before execution',
      );
    }
  }

  /** Build the context object from the set fields. */
  private buildContext(): DelegationContext {
    return {
      env: this.env!,
      db: this.db!,
      userId: this.userId!,
      spaceId: this.spaceId!,
    };
  }

  /** Build strategy helpers that delegate to base-class methods. */
  private buildHelpers(): StrategyHelpers {
    return {
      sleepFn: this.sleep.bind(this),
      retryFn: <T>(fn: () => Promise<T>) => this.executeWithRetry(fn),
      throwIfAborted: this.throwIfAborted.bind(this),
    };
  }
}
