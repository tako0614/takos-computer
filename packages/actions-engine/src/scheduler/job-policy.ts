/**
 * Job result creation, step control classification, and finalization helpers
 */
import type {
  Conclusion,
  JobResult,
  Step,
  StepResult,
} from '../types.ts';

export interface JobExecutionState {
  failed: boolean;
  cancelled: boolean;
}

export interface StepControl {
  shouldStopJob: boolean;
  shouldMarkJobFailed: boolean;
  shouldCancelWorkflow: boolean;
}

export function createCompletedJobResult(
  id: string,
  name: string | undefined,
  conclusion: Conclusion
): JobResult {
  return {
    id,
    name,
    steps: [],
    outputs: {},
    status: 'completed',
    conclusion,
  };
}

export function createInProgressJobResult(
  id: string,
  name: string | undefined
): JobResult {
  return {
    id,
    name,
    steps: [],
    outputs: {},
    status: 'in_progress',
    startedAt: new Date(),
  };
}

export function classifyStepControl(
  step: Step,
  result: StepResult,
  failFast: boolean
): StepControl {
  const shouldStopJob = result.conclusion === 'failure' && !step['continue-on-error'];
  return {
    shouldStopJob,
    shouldMarkJobFailed: shouldStopJob,
    shouldCancelWorkflow: shouldStopJob && failFast,
  };
}

function collectStepOutputs(steps: StepResult[]): Record<string, string> {
  const outputs: Record<string, string> = {};

  for (const stepResult of steps) {
    if (!stepResult.id) {
      continue;
    }
    Object.assign(outputs, stepResult.outputs);
  }

  return outputs;
}

export function finalizeJobResult(
  result: JobResult,
  executionState: JobExecutionState
): void {
  result.status = 'completed';
  result.conclusion = executionState.cancelled
    ? 'cancelled'
    : executionState.failed
      ? 'failure'
      : 'success';
  result.completedAt = new Date();
  result.outputs = collectStepOutputs(result.steps);
}

export function getDependencySkipReason(
  needs: string[],
  results: ReadonlyMap<string, JobResult>
): string | null {
  for (const need of needs) {
    const dependencyResult = results.get(need);
    if (!dependencyResult) {
      continue;
    }

    if (dependencyResult.conclusion === 'success') {
      continue;
    }

    const dependencyOutcome = dependencyResult.conclusion ?? 'did not succeed';
    return `Dependency "${need}" ${dependencyOutcome}`;
  }

  return null;
}
