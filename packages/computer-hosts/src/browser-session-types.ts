/**
 * Type definitions for the BrowserSession container host.
 */

import type { DurableObjectNamespace, R2Bucket } from './cf-types.ts';

export interface KVNamespace {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface BrowserSessionEnv {
  BROWSER_CONTAINER: DurableObjectNamespace;
  BROWSER_CHECKPOINTS?: R2Bucket;
  TAKOS_EGRESS?: { fetch(request: Request): Promise<Response> };
  SESSION_INDEX?: KVNamespace;
}

export interface BrowserSessionTokenInfo {
  sessionId: string;
  spaceId: string;
  userId: string;
}

export interface CreateSessionPayload {
  sessionId: string;
  spaceId: string;
  userId: string;
  url?: string;
  viewport?: { width: number; height: number };
}

export interface BrowserSessionState {
  sessionId: string;
  spaceId: string;
  userId: string;
  status: 'starting' | 'active' | 'stopped';
  createdAt: string;
}
