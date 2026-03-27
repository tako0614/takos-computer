/**
 * Default action resolver for step execution
 */
import type { Step, StepResult, ActionResolver } from '../types.js';

const BUILTIN_NOOP_ACTIONS = new Set(['actions/checkout', 'actions/setup-node']);

/**
 * Default action resolver
 */
export const defaultActionResolver: ActionResolver = async (uses: string) => {
  const normalizedUses = uses.trim().toLowerCase();
  const actionName = normalizedUses.split('@')[0];

  if (BUILTIN_NOOP_ACTIONS.has(actionName)) {
    return {
      run: async (step, context): Promise<StepResult> => {
        const outputs: Record<string, string> = {};

        // Keep checkout compatibility for workflows that read steps.<id>.outputs.path.
        if (actionName === 'actions/checkout') {
          const configuredPath =
            typeof step.with?.path === 'string' && step.with.path.length > 0
              ? step.with.path
              : context.github.workspace;
          outputs.path = configuredPath;
        }

        return {
          id: step.id,
          name: step.name,
          status: 'completed',
          conclusion: 'success',
          outputs,
        };
      },
    };
  }

  return {
    run: async (): Promise<StepResult> => {
      throw new Error(
        `Unsupported action: ${uses}. Provide StepRunnerOptions.actionResolver for action steps.`
      );
    },
  };
};
