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
  APP_AUTH_REQUIRED?: string;
  APP_SESSION_SECRET?: string;
  OIDC_ISSUER_URL?: string;
  OIDC_AUTHORIZATION_URL?: string;
  OIDC_TOKEN_URL?: string;
  OIDC_USERINFO_URL?: string;
  OIDC_JWKS_URL?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_REDIRECT_URI?: string;
  ACCOUNTS_BASE_URL?: string;
  INSTALL_LAUNCH_INSTALLATION_ID?: string;
  INSTALL_LAUNCH_CONSUME_PATH?: string;
  BASE_URL?: string;
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
