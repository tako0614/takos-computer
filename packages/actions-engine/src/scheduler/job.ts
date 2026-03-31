/**
 * Job scheduler and execution management
 */
import type {
  Workflow,
  Job,
  JobResult,
  ExecutionPlan,
  ExecutionContext,
  Conclusion,
} from '../types.ts';
import { evaluateCondition } from '../parser/expression.ts';
import {
  buildDependencyGraph,
  groupIntoPhases,
  type DependencyGraph,
} from './dependency.ts';
import { StepRunner, type StepRunnerOptions } from './step.ts';
import {
  createListenerRegistry,
  type ListenerRegistry,
} from './listener-registry.ts';
import {
  buildNeedsContext,
  buildJobExecutionContext,
  buildStepsContext,
  normalizeNeedsInput,
} from './job-context.ts';
import {
  type JobExecutionState,
  createCompletedJobResult,
  createInProgressJobResult,
  classifyStepControl,
  finalizeJobResult,
  getDependencySkipReason,
} from './job-policy.ts';
import type {
  JobSchedulerEvent,
  JobSchedulerListener,
} from './job-events.ts';

export type { JobSchedulerEvent, JobSchedulerListener } from './job-events.ts';

/**
 * Job scheduler options
 */
export interface JobSchedulerOptions {
  /** Maximum parallel jobs (0 = unlimited) */
  maxParallel?: number;
  /** Fail fast - cancel remaining jobs on first failure */
  failFast?: boolean;
  /** Step runner options */
  stepRunner?: StepRunnerOptions;
}

/**
 * Job scheduler for workflow execution
 */
export class JobScheduler {
  private workflow: Workflow;
  private options: JobSchedulerOptions;
  private graph: DependencyGraph;
  private results: Map<string, JobResult>;
  private listenerRegistry: ListenerRegistry<JobSchedulerEvent, JobSchedulerListener>;
  private cancelled: boolean;
  private running: boolean;
  private stepRunner: StepRunner;

  constructor(workflow: Workflow, options: JobSchedulerOptions = {}) {
    this.workflow = workflow;
    this.options = {
      maxParallel: options.maxParallel ?? 0,
      failFast: options.failFast ?? true,
      stepRunner: options.stepRunner ?? {},
    };
    this.graph = buildDependencyGraph(workflow);
    this.results = new Map();
    this.listenerRegistry =
      createListenerRegistry<JobSchedulerEvent, JobSchedulerListener>();
    this.cancelled = false;
    this.running = false;
    this.stepRunner = new StepRunner(this.options.stepRunner);
  }

  /**
   * Add event listener
   */
  on(listener: JobSchedulerListener): () => void {
    return this.listenerRegistry.on(listener);
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: JobSchedulerEvent): void {
    this.listenerRegistry.emit(event);
  }

  /**
   * Cancel workflow execution
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Reset scheduler runtime state for a new run.
   * Keeps listeners and configuration intact.
   */
  private reset(): void {
    this.results.clear();
    this.cancelled = false;
  }

  /**
   * Create execution plan
   */
  createPlan(): ExecutionPlan {
    // groupIntoPhases already detects cycles via assertAcyclic
    const phases = groupIntoPhases(this.graph);

    return { phases };
  }

  /**
   * Run all jobs in workflow
   */
  async run(context: ExecutionContext): Promise<Record<string, JobResult>> {
    if (this.running) {
      throw new Error('JobScheduler is already running');
    }

    this.running = true;
    this.reset();

    try {
      const plan = this.createPlan();
      this.emit({ type: 'workflow:start', phases: plan.phases });

      for (let phaseIndex = 0; phaseIndex < plan.phases.length; phaseIndex++) {
        if (this.cancelled) break;

        const phase = plan.phases[phaseIndex];
        this.emit({ type: 'phase:start', phase: phaseIndex, jobs: phase });

        // Run jobs in phase (potentially in parallel)
        await this.runPhase(phase, context);

        this.emit({ type: 'phase:complete', phase: phaseIndex });

        // Check for failures in fail-fast mode
        if (this.options.failFast) {
          const phaseFailed = phase.some(
            (jobId) => this.results.get(jobId)?.conclusion === 'failure'
          );
          if (!phaseFailed) {
            continue;
          }

          this.cancelled = true;
          for (let i = phaseIndex + 1; i < plan.phases.length; i++) {
            this.markJobsCancelled(plan.phases[i]);
          }
          break;
        }
      }

      const results = this.getResults();
      this.emit({
        type: 'workflow:complete',
        results: structuredClone(results),
      });
      return results;
    } finally {
      this.running = false;
    }
  }

  /**
   * Run jobs in a single phase
   */
  private async runPhase(
    jobIds: string[],
    context: ExecutionContext
  ): Promise<void> {
    const maxParallel = this.options.maxParallel || jobIds.length;
    const chunks: string[][] = [];

    // Split into chunks based on max parallel
    for (let i = 0; i < jobIds.length; i += maxParallel) {
      chunks.push(jobIds.slice(i, i + maxParallel));
    }

    for (let index = 0; index < chunks.length; index++) {
      if (this.cancelled) {
        this.markPendingChunksCancelled(chunks, index);
        break;
      }

      const chunk = chunks[index];

      await Promise.all(chunk.map((jobId) => this.runJob(jobId, context)));

      if (this.cancelled) {
        this.markPendingChunksCancelled(chunks, index + 1);
        break;
      }
    }
  }

  /**
   * Mark pending chunks as cancelled from the specified index.
   */
  private markPendingChunksCancelled(
    chunks: string[][],
    startIndex: number
  ): void {
    for (let pending = startIndex; pending < chunks.length; pending++) {
      this.markJobsCancelled(chunks[pending]);
    }
  }

  /**
   * Mark jobs as cancelled if they don't already have a result.
   */
  private markJobsCancelled(jobIds: string[]): void {
    for (const jobId of jobIds) {
      if (this.results.has(jobId)) {
        continue;
      }

      this.completeTerminalJob(
        jobId,
        createCompletedJobResult(
          jobId,
          this.workflow.jobs[jobId].name,
          'cancelled'
        )
      );
    }
  }

  /**
   * Run a single job
   */
  private async runJob(
    jobId: string,
    context: ExecutionContext
  ): Promise<JobResult> {
    const job = this.workflow.jobs[jobId];
    const existingResult = this.results.get(jobId);
    const cancellationShortCircuitResult =
      this.getCancellationShortCircuitResult(jobId, job.name, existingResult);

    if (cancellationShortCircuitResult) {
      return cancellationShortCircuitResult;
    }

    // Build job-specific context with needs
    const jobContext = this.buildJobContext(jobId, context);

    // Check if job should be skipped
    if (!evaluateCondition(job.if, jobContext)) {
      return this.skipJob(jobId, job.name, 'Condition not met');
    }

    // Dependencies are success-only: any non-success dependency conclusion skips this job.
    const needs = normalizeNeedsInput(job.needs);
    const dependencySkipReason = getDependencySkipReason(needs, this.results);
    if (dependencySkipReason) {
      return this.skipJob(jobId, job.name, dependencySkipReason);
    }

    this.emit({ type: 'job:start', jobId, job });

    const result = createInProgressJobResult(jobId, job.name);
    let executionState: JobExecutionState;

    try {
      executionState = await this.executeJobSteps(job, jobContext, result);
    } catch {
      executionState = { failed: true, cancelled: false };
    }

    return this.finalizeAndStoreJobResult(jobId, result, executionState);
  }

  /**
   * Resolve runJob short-circuit result when cancellation state allows bypassing execution.
   */
  private getCancellationShortCircuitResult(
    jobId: string,
    jobName: JobResult['name'],
    existingResult?: JobResult
  ): JobResult | undefined {
    if (existingResult?.conclusion === 'cancelled') {
      return structuredClone(existingResult);
    }

    if (!this.cancelled) {
      return undefined;
    }

    if (existingResult) {
      return structuredClone(existingResult);
    }

    return this.completeTerminalJob(
      jobId,
      createCompletedJobResult(jobId, jobName, 'cancelled')
    );
  }

  /**
   * Execute all steps for a job and return the final execution state.
   */
  private async executeJobSteps(
    job: Job,
    jobContext: ExecutionContext,
    result: JobResult
  ): Promise<JobExecutionState> {
    const executionState: JobExecutionState = { failed: false, cancelled: false };

    for (let i = 0; i < job.steps.length; i++) {
      if (this.cancelled) {
        executionState.cancelled = true;
        break;
      }

      const step = job.steps[i];
      const stepContext = this.buildStepContext(jobContext, result);
      const stepResult = await this.stepRunner.runStep(step, stepContext, {
        index: i,
      });
      result.steps.push(stepResult);

      const stepControl = classifyStepControl(
        step,
        stepResult,
        this.options.failFast ?? true
      );
      if (!stepControl.shouldStopJob) {
        continue;
      }

      if (stepControl.shouldMarkJobFailed) {
        executionState.failed = true;
      }
      if (stepControl.shouldCancelWorkflow) {
        this.cancelled = true;
      }
      break;
    }

    return executionState;
  }

  /**
   * Finalize and record a completed job result.
   */
  private finalizeAndStoreJobResult(
    jobId: string,
    result: JobResult,
    executionState: JobExecutionState
  ): JobResult {
    finalizeJobResult(result, executionState);
    return this.completeTerminalJob(jobId, result);
  }

  /**
   * Create, store, and emit skip result for a job.
   */
  private skipJob(
    jobId: string,
    jobName: JobResult['name'],
    reason: string
  ): JobResult {
    return this.completeTerminalJob(
      jobId,
      createCompletedJobResult(jobId, jobName, 'skipped'),
      { skipReason: reason }
    );
  }

  /**
   * Store terminal job result and emit terminal job events.
   */
  private completeTerminalJob(
    jobId: string,
    result: JobResult,
    options: { skipReason?: string } = {}
  ): JobResult {
    const storedResult = structuredClone(result);
    this.results.set(jobId, storedResult);
    this.emitTerminalObservationEvents(
      jobId,
      storedResult,
      options.skipReason
    );
    return structuredClone(storedResult);
  }

  /**
   * Emit terminal observation events for a job.
   */
  private emitTerminalObservationEvents(
    jobId: string,
    storedResult: JobResult,
    skipReason?: string
  ): void {
    if (skipReason !== undefined) {
      this.emit({
        type: 'job:skip',
        jobId,
        reason: skipReason,
        result: structuredClone(storedResult),
      });
    }

    this.emit({
      type: 'job:complete',
      jobId,
      result: structuredClone(storedResult),
    });
  }

  /**
   * Build execution context with needs data
   */
  private buildJobContext(
    jobId: string,
    context: ExecutionContext
  ): ExecutionContext {
    const job = this.workflow.jobs[jobId];
    const needs = normalizeNeedsInput(job.needs);
    const needsContext = buildNeedsContext(needs, this.results);
    return buildJobExecutionContext(context, needsContext, [
      context.env,
      this.workflow.env,
      job.env,
    ]);
  }

  /**
   * Build step context with previous step outputs
   */
  private buildStepContext(
    jobContext: ExecutionContext,
    jobResult: JobResult
  ): ExecutionContext {
    const stepsContext = buildStepsContext(jobResult.steps);

    return {
      ...jobContext,
      steps: stepsContext,
    };
  }

  /**
   * Get current results
   */
  getResults(): Record<string, JobResult> {
    return structuredClone(Object.fromEntries(this.results));
  }

  /**
   * Get overall conclusion
   */
  getConclusion(): Conclusion {
    let hasFailure = false;
    for (const result of this.results.values()) {
      if (result.conclusion === 'failure') {
        hasFailure = true;
        break;
      }
    }

    if (hasFailure) {
      return 'failure';
    }

    if (this.cancelled) {
      return 'cancelled';
    }

    return 'success';
  }
}

/**
 * Create execution plan for workflow
 */
export function createExecutionPlan(workflow: Workflow): ExecutionPlan {
  const graph = buildDependencyGraph(workflow);
  const phases = groupIntoPhases(graph);
  return { phases };
}
