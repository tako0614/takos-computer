import type { AgentMessage } from './types.ts';
import type { WorkflowContext, ReviewResult } from './workflow-types.ts';
import { extractJsonFromLLMResponse } from './workflow-types.ts';
import { createLLMClient } from './llm.ts';
import { generateId, now } from '../../shared/utils.ts';
import { getDb, pullRequests, prReviews } from '../../infra/db.ts';
import { eq } from 'drizzle-orm';
import { buildPRDiffText } from '../../pull-requests/ai-review.ts';
import { logError } from '../../shared/utils/logger.ts';

// ── Prompts ─────────────────────────────────────────────────────────────

const REVIEW_PROMPT = `You are a code reviewer. Review the following changes and provide feedback.

Changes (diff):
{diff}

Original task:
{task}

Provide a thorough review including:
1. Overall assessment (approved, changes_requested, or commented)
2. Any bugs or issues found
3. Code quality concerns
4. Security considerations
5. Suggestions for improvement

Return a JSON object with:
- status: "approved" | "changes_requested" | "commented"
- summary: Brief overall assessment
- issues: Array of { severity: "error"|"warning"|"info", file?: string, line?: number, message: string, suggestion?: string }
- suggestions: Array of improvement suggestions

Respond ONLY with valid JSON.`;

// ── Review ──────────────────────────────────────────────────────────────

export async function executeReview(
  context: WorkflowContext,
  prId: string,
  reviewType: 'self' | 'separate_ai'
): Promise<ReviewResult> {
  const { env } = context;
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API key not configured for review');
  }

  const db = getDb(env.DB);

  const pr = await db.select().from(pullRequests).where(eq(pullRequests.id, prId)).get();

  if (!pr) {
    throw new Error(`PR not found: ${prId}`);
  }

  const diff = await getPRDiff(context, pr);
  const prompt = REVIEW_PROMPT
    .replace('{diff}', diff)
    .replace('{task}', pr.description || pr.title);

  const llm = createLLMClient(apiKey);
  const messages: AgentMessage[] = [
    { role: 'system', content: 'You are a code reviewer. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ];

  const response = await llm.chat(messages);

  let reviewResult: ReviewResult;
  try {
    reviewResult = JSON.parse(extractJsonFromLLMResponse(response.content)) as ReviewResult;
  } catch (parseError) {
    logError('Failed to parse review JSON', parseError, { module: 'services/agent/workflow' });
    reviewResult = {
      status: 'commented',
      summary: 'Review parsing failed - manual review recommended',
      issues: [{
        severity: 'warning',
        message: 'AI review response could not be parsed',
      }],
      suggestions: [],
    };
  }

  const reviewId = generateId();
  const timestamp = now();

  await db.insert(prReviews).values({
    id: reviewId,
    prId,
    reviewerType: 'ai',
    reviewerId: null,
    status: reviewResult.status,
    body: reviewResult.summary,
    analysis: JSON.stringify({ issues: reviewResult.issues, suggestions: reviewResult.suggestions }),
    createdAt: timestamp,
  });

  return reviewResult;
}

// ── PR diff helper ──────────────────────────────────────────────────────

async function getPRDiff(
  context: WorkflowContext,
  pr: { repoId: string; number: number; title: string; headBranch: string; baseBranch: string }
): Promise<string> {
  let diffResult: Awaited<ReturnType<typeof buildPRDiffText>>;
  try {
    diffResult = await buildPRDiffText(context.env, pr.repoId, pr.baseBranch, pr.headBranch);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to build PR diff: ${reason}`);
  }

  if (!diffResult.diffText) {
    const skippedInfo = diffResult.skipped.length > 0
      ? ` (skipped: ${diffResult.skipped.join(', ')})`
      : '';
    throw new Error(`No textual diff available for PR #${pr.number}${skippedInfo}`);
  }

  return [
    `PR #${pr.number}: ${pr.title}`,
    `Base: ${pr.baseBranch}`,
    `Head: ${pr.headBranch}`,
    `Changed files: ${diffResult.totalFiles}`,
    diffResult.skipped.length > 0 ? `Skipped: ${diffResult.skipped.join(', ')}` : '',
    '',
    diffResult.diffText,
  ].filter(Boolean).join('\n');
}
