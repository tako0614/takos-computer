import { assertEquals, assert, assertMatch } from 'jsr:@std/assert';

import type { Workflow } from '../../types.ts';
import {
  buildDependencyGraph,
  DependencyError,
  groupIntoPhases,
} from '../../scheduler/dependency.ts';

Deno.test('dependency helpers - throws DependencyError with circular message shape for phase grouping', () => {
  const workflow: Workflow = {
    name: 'cycle-workflow',
    on: 'push',
    jobs: {
      a: {
        'runs-on': 'ubuntu-latest',
        needs: 'c',
        steps: [{ run: 'echo a' }],
      },
      b: {
        'runs-on': 'ubuntu-latest',
        needs: 'a',
        steps: [{ run: 'echo b' }],
      },
      c: {
        'runs-on': 'ubuntu-latest',
        needs: 'b',
        steps: [{ run: 'echo c' }],
      },
    },
  };
  const graph = buildDependencyGraph(workflow);

  const toDependencyError = (fn: () => unknown): DependencyError => {
    try {
      fn();
    } catch (error) {
      assert(error instanceof DependencyError);
      return error as DependencyError;
    }
    throw new Error('Expected DependencyError to be thrown');
  };

  const phaseError = toDependencyError(() => groupIntoPhases(graph));

  assertMatch(
    phaseError.message,
    /^Circular dependency detected: .+( -> .+)+$/,
  );
});
