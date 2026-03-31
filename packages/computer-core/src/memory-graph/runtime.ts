/**
 * Agent memory runtime stub.
 *
 * In the original control package this has full D1 implementation.
 * Here we provide the interface and a minimal pass-through to the backend.
 */

import type { D1Database } from '../shared/types/bindings.ts';
import type { Env } from '../shared/types.ts';
import type { ActivationResult, Claim, Evidence, ToolObserver } from './types.ts';

const EMPTY_ACTIVATION: ActivationResult = { bundles: [], segment: '', hasContent: false };

export interface AgentMemoryBackend {
  bootstrap(): Promise<ActivationResult>;
  finalize(input: {
    claims: Claim[];
    evidence: Evidence[];
  }): Promise<void>;
}

export class AgentMemoryRuntime {
  private cachedActivation: ActivationResult | null = null;
  private backend?: AgentMemoryBackend;
  private overlayClaims: Claim[] = [];
  private overlayEvidence: Evidence[] = [];

  constructor(
    _db: D1Database,
    _context: { spaceId: string; runId: string },
    _env: Env,
    backend?: AgentMemoryBackend,
  ) {
    this.backend = backend;
  }

  async bootstrap(): Promise<ActivationResult> {
    if (this.backend) {
      try {
        this.cachedActivation = await this.backend.bootstrap();
        return this.cachedActivation;
      } catch {
        this.cachedActivation = EMPTY_ACTIVATION;
        return this.cachedActivation;
      }
    }
    this.cachedActivation = EMPTY_ACTIVATION;
    return this.cachedActivation;
  }

  beforeModel(): ActivationResult {
    return this.cachedActivation ?? EMPTY_ACTIVATION;
  }

  createToolObserver(): ToolObserver {
    return {
      observe: (_event) => {
        // Overlay observer — best-effort collection
      },
    };
  }

  async finalize(): Promise<void> {
    if (this.backend) {
      await this.backend.finalize({
        claims: this.overlayClaims,
        evidence: this.overlayEvidence,
      });
    }
  }
}
