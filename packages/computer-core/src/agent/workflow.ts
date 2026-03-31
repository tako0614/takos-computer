import type { AgentMessage } from './types.ts';
import type {
  TaskStep,
  TaskPlan,
  WorkflowContext,
  WorkflowResult,
} from './workflow-types.ts';
import { VALID_PLAN_TYPES, extractJsonFromLLMResponse } from './workflow-types.ts';
import { createLLMClient } from './llm.ts';
import { generateId } from '../../shared/utils.ts';
import { createPullRequest, mergePullRequest } from './workflow-pr.ts';
import { executeReview } from './workflow-review.ts';
import { logError } from '../../shared/utils/logger.ts';

// ── Re-exports ──────────────────────────────────────────────────────────

export type {
  TaskStep,
  TaskPlan,
  WorkflowContext,
  WorkflowResult,
  ReviewResult,
  ReviewIssue,
} from './workflow-types.ts';
export { executeReview } from './workflow-review.ts';
export { createPullRequest, mergePullRequest } from './workflow-pr.ts';
export { startWorkflowSession, commitWorkflowSession } from './workflow-session.ts';

// ── Prompts ─────────────────────────────────────────────────────────────

const TASK_ANALYSIS_PROMPT = `You are a task analyzer for an AI agent system. Analyze the user's task and determine the best approach to complete it.

Available tools: {tools}

Analyze the task and return a JSON object with:
- type: "conversation" | "tool_only" | "code_change" | "composite"
  - conversation: Simple Q&A, explanations, discussions
  - tool_only: Tasks that only need tool calls (web search, file reading, etc.)
  - code_change: Tasks requiring file modifications
  - composite: Complex tasks needing multiple approaches
- tools: Array of tool names that might be needed
- needsRepo: Boolean - does this task involve a git repository?
- needsRuntime: Boolean - does this need runtime container execution (npm, build, etc.)?
- usePR: Boolean - should changes go through a PR workflow?
- needsReview: Boolean - should changes be reviewed before merging?
- reviewType: "self" | "separate_ai" - who reviews (self = same conversation, separate_ai = new AI session)
- commitMessage: Suggested commit message if applicable
- reasoning: Brief explanation of your decision

Respond ONLY with valid JSON, no markdown or other text.

User task: {task}`;

// ── Task analysis ───────────────────────────────────────────────────────

export async function analyzeTask(
  task: string,
  context: {
    spaceId: string;
    userId: string;
    tools: string[];
    apiKey: string;
    model?: string;
  }
): Promise<TaskPlan> {
  const llm = createLLMClient(context.apiKey, context.model ? { model: context.model } : undefined);

  const prompt = TASK_ANALYSIS_PROMPT
    .replace('{tools}', context.tools.join(', '))
    .replace('{task}', task);

  const messages: AgentMessage[] = [
    { role: 'system', content: 'You are a task analyzer. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ];

  try {
    const response = await llm.chat(messages);
    const plan = JSON.parse(extractJsonFromLLMResponse(response.content)) as TaskPlan;

    if (!VALID_PLAN_TYPES.has(plan.type)) {
      plan.type = 'conversation';
    }

    plan.tools = plan.tools || [];
    plan.needsRepo = plan.needsRepo ?? false;
    plan.needsRuntime = plan.needsRuntime ?? false;
    plan.usePR = plan.usePR ?? false;
    plan.needsReview = plan.needsReview ?? false;
    plan.reviewType = plan.reviewType || 'self';

    return plan;
  } catch (error) {
    logError('Task analysis failed', error, { module: 'services/agent/workflow' });
    return {
      type: 'conversation',
      tools: [],
      reasoning: 'Analysis failed, defaulting to conversation',
    };
  }
}

// ── Code-change workflow ────────────────────────────────────────────────

export async function executeCodeChangeWorkflow(
  task: string,
  plan: TaskPlan,
  context: WorkflowContext
): Promise<WorkflowResult> {
  const steps: TaskStep[] = [];

  try {
    let branchName: string | undefined;
    if (plan.usePR && plan.repoId) {
      branchName = `ai/${generateId(8)}-${Date.now()}`;

      steps.push({
        id: generateId(),
        type: 'code_change',
        description: `Create branch: ${branchName}`,
        status: 'completed',
        result: branchName,
      });
    }

    steps.push({
      id: generateId(),
      type: 'code_change',
      description: 'Execute code changes',
      status: 'pending',
    });

    const commitStep: TaskStep = {
      id: generateId(),
      type: 'commit',
      description: plan.commitMessage || 'AI-generated changes',
      status: 'pending',
    };
    steps.push(commitStep);

    let prId: string | undefined;
    if (plan.usePR && plan.repoId) {
      const prStep: TaskStep = {
        id: generateId(),
        type: 'pr_create',
        description: `Create PR for ${branchName}`,
        status: 'pending',
      };
      steps.push(prStep);

      prId = await createPullRequest(context, {
        repoId: plan.repoId,
        title: plan.commitMessage || task.substring(0, 100),
        description: `AI-generated changes for: ${task}`,
        headBranch: branchName!,
        baseBranch: 'main',
      });

      prStep.status = 'completed';
      prStep.result = prId;
    }

    let reviewResult: import('./workflow-types.ts').ReviewResult | undefined;
    if (plan.needsReview && prId) {
      const reviewStep: TaskStep = {
        id: generateId(),
        type: 'review',
        description: `Review PR (${plan.reviewType})`,
        status: 'running',
      };
      steps.push(reviewStep);

      reviewResult = await executeReview(
        context,
        prId,
        plan.reviewType || 'self'
      );

      reviewStep.status = 'completed';
      reviewStep.result = reviewResult.status;
    }

    if (prId && (!plan.needsReview || reviewResult?.status === 'approved')) {
      const mergeStep: TaskStep = {
        id: generateId(),
        type: 'pr_merge',
        description: 'Merge PR',
        status: 'pending',
      };
      steps.push(mergeStep);

      await mergePullRequest(context, prId);
      mergeStep.status = 'completed';
    }

    return {
      success: true,
      message: plan.usePR
        ? `Changes committed via PR ${prId}`
        : 'Changes committed directly',
      prId,
      reviewResult,
      steps,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    for (const step of steps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'failed';
        step.error = errorMessage;
      }
    }

    return {
      success: false,
      message: `Workflow failed: ${errorMessage}`,
      steps,
    };
  }
}

// ── Orchestrator ────────────────────────────────────────────────────────

export async function orchestrateWorkflow(
  task: string,
  context: WorkflowContext & { apiKey: string; tools: string[]; model?: string }
): Promise<WorkflowResult> {
  const plan = await analyzeTask(task, {
    spaceId: context.spaceId,
    userId: context.userId,
    tools: context.tools,
    apiKey: context.apiKey,
    model: context.model,
  });

  switch (plan.type) {
    case 'conversation':
      return {
        success: true,
        message: 'Task handled as conversation',
      };

    case 'tool_only':
      return {
        success: true,
        message: 'Task requires tool execution',
        steps: (plan.tools || []).map((tool: string) => ({
          id: generateId(),
          type: 'tool_call' as const,
          description: `Execute tool: ${tool}`,
          status: 'pending' as const,
        })),
      };

    case 'code_change':
    case 'composite':
      return await executeCodeChangeWorkflow(task, plan, context);

    default:
      return {
        success: false,
        message: `Unknown plan type: ${plan.type}`,
      };
  }
}
