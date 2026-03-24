/**
 * Memory graph types used by the agent runner.
 *
 * Extracted from takos/packages/control/src/application/services/memory-graph/types.ts.
 */

export type ClaimType = 'fact' | 'preference' | 'decision' | 'observation';
export type ClaimStatus = 'active' | 'superseded' | 'retracted';

export interface Claim {
  id: string;
  accountId: string;
  claimType: ClaimType;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: ClaimStatus;
  supersededBy: string | null;
  sourceRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EvidenceKind = 'supports' | 'contradicts' | 'context';
export type EvidenceSourceType = 'tool_result' | 'user_message' | 'agent_inference' | 'memory_recall';

export interface Evidence {
  id: string;
  accountId: string;
  claimId: string;
  kind: EvidenceKind;
  sourceType: EvidenceSourceType;
  sourceRef: string | null;
  content: string;
  trust: number;
  taint: string | null;
  createdAt: string;
}

export interface ActivationBundle {
  claim: Claim;
  evidence: Evidence[];
}

export interface ActivationResult {
  bundles: ActivationBundle[];
  segment: string;
  hasContent: boolean;
}

export interface ToolObserver {
  observe(event: {
    toolName: string;
    arguments: Record<string, unknown>;
    result: string;
    error?: string;
    timestamp: number;
    duration: number;
  }): void;
}
