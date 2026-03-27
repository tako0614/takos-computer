import type { Env } from '../../shared/types';

// ── Public types ────────────────────────────────────────────────────────

export interface TaskStep {
  id: string;
  type: 'tool_call' | 'code_change' | 'review' | 'commit' | 'pr_create' | 'pr_merge';
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
}

export interface TaskPlan {
  type: 'conversation' | 'tool_only' | 'code_change' | 'composite';
  tools?: string[];
  needsRepo?: boolean;
  repoId?: string;
  needsRuntime?: boolean;
  usePR?: boolean;
  needsReview?: boolean;
  reviewType?: 'self' | 'separate_ai';
  commitMessage?: string;
  steps?: TaskStep[];
  reasoning?: string;
}

export interface WorkflowContext {
  env: Env;
  spaceId: string;
  userId: string;
  threadId: string;
  runId: string;
  sessionId?: string;
  repoId?: string;
}

export interface WorkflowResult {
  success: boolean;
  message: string;
  prId?: string;
  commitHash?: string;
  reviewResult?: ReviewResult;
  steps?: TaskStep[];
}

export interface ReviewResult {
  status: 'approved' | 'changes_requested' | 'commented';
  summary: string;
  issues: ReviewIssue[];
  suggestions: string[];
}

export interface ReviewIssue {
  severity: 'error' | 'warning' | 'info';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

// ── Shared helpers ──────────────────────────────────────────────────────

/** Valid task plan types. */
export const VALID_PLAN_TYPES: ReadonlySet<string> = new Set([
  'conversation', 'tool_only', 'code_change', 'composite',
]);

/** Strip markdown code fences from an LLM response and return the JSON body. */
export function extractJsonFromLLMResponse(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;
  return trimmed.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
}

/** Response shape returned by the runtime snapshot endpoint. */
export interface RuntimeSnapshotResponse {
  files: Array<{ path: string; content: string; size: number }>;
}
