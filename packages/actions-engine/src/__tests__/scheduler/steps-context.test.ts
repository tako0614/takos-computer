import { assertEquals, assertNotEquals } from 'jsr:@std/assert';

import type { StepResult } from '../../types.ts';
import {
  buildStepsContext,
} from '../../scheduler/job-context.ts';

function createStepResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    id: 'step',
    status: 'completed',
    outputs: {},
    ...overrides,
  };
}

Deno.test('steps-context - builds context entries from step results and ignores anonymous steps', () => {
  const firstOutputs = { first: '1' };
  const secondOutputs = { second: '2' };
  const stepsContext = buildStepsContext([
    createStepResult({
      id: 'build',
      outputs: firstOutputs,
      conclusion: 'success',
    }),
    createStepResult({
      id: undefined,
      outputs: { ignored: 'true' },
      conclusion: 'failure',
    }),
    createStepResult({
      id: 'build',
      outputs: secondOutputs,
      conclusion: 'failure',
    }),
  ]);

  assertEquals(stepsContext, {
    build: {
      outputs: { second: '2' },
      outcome: 'failure',
      conclusion: 'failure',
    },
  });
  assertNotEquals(stepsContext.build.outputs, secondOutputs);
  assertNotEquals(stepsContext.build.outputs, firstOutputs);
});
