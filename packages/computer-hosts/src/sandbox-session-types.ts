/**
 * Type definitions for the SandboxSession container host.
 */

import type { DurableObjectNamespace, KVNamespace } from "./cf-types.ts";
import type { SandboxSessionContainer } from "./sandbox-host.ts";

// Wire shapes are owned by `common` so the host worker and dashboard share one
// definition.
export type {
  CreateSandboxSessionPayload,
  SandboxSessionState,
} from "@takos-computer/common/sandbox-session";

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
  MCP_URL?: string;
  APP_WORKSPACE_ID?: string;
  APP_CAPSULE_ID?: string;
  TAKOS_API_URL?: string;
  TAKOS_TOKEN?: string;
  TAKOS_TRUST_ROUTED_GUI_API?: string;
  /** Per-GUI-principal cap on live sessions (default 10). */
  MAX_SANDBOX_SESSIONS_PER_USER?: string;
  SESSION_INDEX?: KVNamespace;
}

export interface SandboxSessionTokenInfo {
  sessionId: string;
  spaceId: string;
  userId: string;
}

/**
 * Reserved owner/id namespace for published-MCP (`/mcp`) sessions. Their DO
 * name + index id is `pmcp-<tokenHash>:<logicalId>`. GUI auth treats this as a
 * reserved namespace that a GUI principal can never own or address, so a
 * published-token holder cannot plant a co-inhabited sandbox into a GUI user's
 * session list by setting `user_id`/`space_id` to a victim's tuple.
 */
export const PUBLISHED_MCP_SCOPE_PREFIX = "pmcp-";

export function isPublishedScopedId(id: string): boolean {
  return id.startsWith(PUBLISHED_MCP_SCOPE_PREFIX);
}
