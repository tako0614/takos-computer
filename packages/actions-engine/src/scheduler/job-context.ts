/**
 * Job execution context building helpers
 */
import type {
  ExecutionContext,
  JobResult,
  StepResult,
} from '../types.ts';

type NeedsResult = ExecutionContext['needs'][string]['result'];

function normalizeNeedsResult(conclusion: JobResult['conclusion']): NeedsResult {
  if (
    conclusion === 'failure' ||
    conclusion === 'cancelled' ||
    conclusion === 'skipped'
  ) {
    return conclusion;
  }
  return 'success';
}

export function buildNeedsContext(
  needs: string[],
  results: ReadonlyMap<string, JobResult>
): ExecutionContext['needs'] {
  const needsContext: ExecutionContext['needs'] = {};

  for (const need of needs) {
    const needResult = results.get(need);
    if (!needResult) {
      continue;
    }

    needsContext[need] = {
      outputs: { ...needResult.outputs },
      result: normalizeNeedsResult(needResult.conclusion),
    };
  }

  return needsContext;
}

export function buildJobExecutionContext(
  context: ExecutionContext,
  needsContext: ExecutionContext['needs'],
  envSources: Array<Record<string, string> | undefined>
): ExecutionContext {
  const env = Object.assign(
    {},
    ...envSources.filter((source): source is Record<string, string> => Boolean(source))
  );

  return {
    ...context,
    env,
    needs: needsContext,
    job: {
      ...context.job,
      status: 'success',
    },
    steps: {},
  };
}

export function buildStepsContext(stepResults: StepResult[]): ExecutionContext['steps'] {
  const stepsContext: ExecutionContext['steps'] = {};

  for (const stepResult of stepResults) {
    if (stepResult.id) {
      const conclusion = stepResult.conclusion || 'success';
      stepsContext[stepResult.id] = {
        outputs: { ...stepResult.outputs },
        outcome: conclusion,
        conclusion,
      };
    }
  }

  return stepsContext;
}

export function normalizeNeedsInput(needs: unknown): string[] {
  if (typeof needs === 'string') return [needs];
  if (Array.isArray(needs)) return needs.filter((need): need is string => typeof need === 'string');
  return [];
}
