/**
 * Type definitions for the SandboxSession container host.
 */

import type { DurableObjectNamespace } from "./cf-types.ts";
import type { SandboxSessionContainer } from "./sandbox-host.ts";

export interface SandboxHostEnv {
  SANDBOX_CONTAINER: DurableObjectNamespace<SandboxSessionContainer>;
  SANDBOX_HOST_AUTH_TOKEN?: string;
  PUBLISHED_MCP_AUTH_TOKEN?: string;
  MCP_AUTH_TOKEN?: string;
  TAKOS_API_URL?: string;
  TAKOS_TOKEN?: string;
  TAKOS_TRUST_ROUTED_GUI_API?: string;
  SESSION_INDEX?: KVNamespace;
}

export interface KVNamespace {
  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get(key: string, options: { type: "json" }): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(
    options?: { prefix?: string; limit?: number; cursor?: string },
  ): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface SandboxSessionTokenInfo {
  sessionId: string;
  spaceId: string;
  userId: string;
}

export interface CreateSandboxSessionPayload {
  sessionId: string;
  spaceId: string;
  userId: string;
}

export interface SandboxSessionState {
  sessionId: string;
  spaceId: string;
  userId: string;
  status: "starting" | "active" | "stopped";
  createdAt: string;
}
