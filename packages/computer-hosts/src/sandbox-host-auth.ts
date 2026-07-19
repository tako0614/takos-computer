/**
 * Sandbox host auth helpers.
 *
 * The sandbox-host worker accepts three kinds of caller:
 *
 *   1. Host admin — presents `SANDBOX_HOST_AUTH_TOKEN` as a Bearer token,
 *      `X-Proxy-Token` header, or `?authToken=` / `?hostToken=` query
 *      parameter on GUI paths (the query token is exchanged for an admin
 *      cookie via a 302 redirect).
 *   2. Per-session client — presents the proxy token returned by
 *      `POST /create` as a Bearer token or an `X-Proxy-Token` header (it is a
 *      programmatic credential, never a browser cookie).
 *   3. Takosumi-routed GUI request — trusted iff
 *      `TAKOS_TRUST_ROUTED_GUI_API=1` and the `X-Takos-Internal-Marker: 1`
 *      header is set by the dashboard proxy. When configured, GUI requests
 *      can also fall back to the OIDC-backed GUI app session via
 *      `requireGuiAppAuth` / `requireGuiAppOrRedirect` from `app-auth.ts`.
 *
 * This module owns the token / cookie plumbing and the
 * `resolveHostAdminScope` / `authorizeSessionAccess` / `authorizeGuiApp` /
 * `requirePublishedMcpAuth` gates that the routes in `sandbox-host.ts`
 * compose. Cookie names, lifetimes, and query-param names are part of the
 * public surface and must stay in sync with the GUI assets.
 */

import type { Context } from "hono";
import {
  type GuiSession,
  guiAppAuthRequired,
  parseCookie,
  readGuiSession,
  requireGuiAppAuth,
  requireGuiAppOrRedirect,
} from "./app-auth.ts";
import { constantTimeEqual } from "@takos-computer/common/crypto";
import type { DurableObjectStub } from "./cf-types.ts";
import { getDOStub } from "./sandbox-session-container.ts";
import {
  authorizeInterfaceOAuthBearer,
  hasValidInterfaceOAuthConfiguration,
} from "./interface-oauth-auth.ts";
import type { SandboxSessionContainer } from "./sandbox-session-container.ts";
import {
  isPublishedScopedId,
  type SandboxHostEnv,
  type SandboxSessionState,
} from "./sandbox-session-types.ts";

type Env = SandboxHostEnv;
type AppContext = Context<{ Bindings: Env }>;

export const GUI_ADMIN_COOKIE = "takos_computer_admin_token";
export const GUI_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60;

export function resolvePublishedMcpAuthToken(env: Env): string | undefined {
  return env.PUBLISHED_MCP_AUTH_TOKEN || undefined;
}

export type PublishedMcpPrincipal =
  | { kind: "direct"; namespaceSeed: string }
  | {
      kind: "interface_oauth";
      namespaceSeed: string;
      subject: string;
      workspaceId: string;
      capsuleId: string;
      interfaceBindingId: string;
    };

const publishedMcpPrincipals = new WeakMap<object, PublishedMcpPrincipal>();

export function publishedMcpPrincipal(
  c: AppContext,
): PublishedMcpPrincipal | null {
  return publishedMcpPrincipals.get(c) ?? null;
}

export function hasPublishedMcpInterfaceOAuth(env: Env): boolean {
  return hasValidInterfaceOAuthConfiguration({
    issuerUrl: env.OIDC_ISSUER_URL,
    audience: env.MCP_URL,
    workspaceId: env.APP_WORKSPACE_ID,
    capsuleId: env.APP_CAPSULE_ID,
  });
}

export function authError(
  c: AppContext,
  status: 401 | 403 | 503,
  message: string,
): Response {
  return c.json({ error: message }, status);
}

export function isTrustedTakosRoutedRequest(c: AppContext): boolean {
  return (
    c.env.TAKOS_TRUST_ROUTED_GUI_API === "1" &&
    c.req.header("X-Takos-Internal-Marker") === "1"
  );
}

export function isGuiPath(pathname: string): boolean {
  return pathname === "/gui" || pathname.startsWith("/gui/");
}

export function extractBearerToken(c: AppContext): string | null {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    return token || null;
  }

  const headerToken = c.req.header("X-Proxy-Token")?.trim();
  if (headerToken) return headerToken;

  if (isGuiPath(new URL(c.req.url).pathname)) {
    return parseCookie(c.req.header("Cookie"), GUI_ADMIN_COOKIE);
  }

  return null;
}

function buildAuthCookie(c: AppContext, name: string, value: string): string {
  const secure = new URL(c.req.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(
    value,
  )}; Path=/gui; Max-Age=${GUI_AUTH_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}

function redirectWithoutGuiAuthQuery(
  c: AppContext,
  cookieName: string,
  token: string,
): Response {
  const url = new URL(c.req.url);
  url.searchParams.delete("authToken");
  url.searchParams.delete("hostToken");
  url.searchParams.delete("proxyToken");
  const location = `${url.pathname}${url.search}`;
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      Location: location,
      "Set-Cookie": buildAuthCookie(c, cookieName, token),
    },
  });
}

function validateHostAdminToken(c: AppContext, token: string): Response | null {
  const expected = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (!expected) {
    return authError(c, 503, "Sandbox host auth token is not configured");
  }
  if (!constantTimeEqual(token, expected)) {
    return authError(c, 401, "Unauthorized");
  }
  return null;
}

function guiSessionIdFromPath(pathname: string): string | null {
  for (const prefix of ["/gui/sandbox/", "/gui/session/", "/gui/sessions/"]) {
    if (!pathname.startsWith(prefix)) continue;
    const raw = pathname.slice(prefix.length).split("/")[0];
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

async function validateSessionProxyToken(
  c: AppContext,
  sessionId: string,
  token: string,
): Promise<Response | null> {
  const stub = getDOStub(c.env, sessionId);
  const tokenInfo = await stub.verifyProxyToken(token);
  if (!tokenInfo || tokenInfo.sessionId !== sessionId) {
    return authError(c, 401, "Unauthorized");
  }
  return null;
}

// SECURITY (#10/#25 cross-tenant IDOR): a validly-sealed GUI session cookie
// only proves *some* user is authenticated — it does not bind that user to a
// particular sandbox session. The GUI session carries the caller's identity
// (`sub` = userId) and, when issued via the Takosumi launch/OIDC claims, the
// owning `spaceId`. A persisted SandboxSessionState carries the session's
// `userId`/`spaceId`. A GUI caller may touch a session only when both match.
export function guiSessionOwnsSandbox(
  guiSession: GuiSession,
  state: Pick<SandboxSessionState, "userId" | "spaceId" | "sessionId">,
): boolean {
  // SECURITY (published-MCP confused deputy): a published-token holder can set
  // an arbitrary `user_id`/`space_id` on a sandbox it provisions. Those land in
  // the Capsule-wide session index, so a GUI principal must never be able to
  // own/address a published-scoped session even when its stored `userId`
  // matches the caller's `sub`. The published namespace is reserved.
  if (isPublishedScopedId(state.sessionId)) return false;
  if (guiSession.sub !== state.userId) return false;
  // When the GUI session asserts a space scope, it must match the session's
  // space. A space-less GUI session (no `takosumi.space_id` claim — including a
  // plain `openid profile email` OIDC login) is intentionally bound by `sub`
  // alone, so it can reach that user's own sandboxes across the user's spaces.
  // This is same-user only (never a cross-user/cross-tenant escalation).
  if (guiSession.spaceId && guiSession.spaceId !== state.spaceId) return false;
  return true;
}

export async function authorizeGuiApp(c: AppContext): Promise<Response | null> {
  if (isTrustedTakosRoutedRequest(c)) return null;

  const url = new URL(c.req.url);
  const adminQueryToken =
    url.searchParams.get("authToken")?.trim() ||
    url.searchParams.get("hostToken")?.trim();
  if (adminQueryToken) {
    const auth = validateHostAdminToken(c, adminQueryToken);
    if (auth) return auth;
    return redirectWithoutGuiAuthQuery(c, GUI_ADMIN_COOKIE, adminQueryToken);
  }

  const sessionId = guiSessionIdFromPath(url.pathname);
  const adminCookie = parseCookie(c.req.header("Cookie"), GUI_ADMIN_COOKIE);
  if (adminCookie) {
    const auth = validateHostAdminToken(c, adminCookie);
    if (!auth) return null;
  }

  const headerToken = extractBearerToken(c);
  if (headerToken) {
    const adminAuth = validateHostAdminToken(c, headerToken);
    if (!adminAuth) return null;
    if (sessionId) {
      const proxyAuth = await validateSessionProxyToken(
        c,
        sessionId,
        headerToken,
      );
      if (!proxyAuth) return null;
    }
  }

  if (guiAppAuthRequired(c.env)) {
    return await requireGuiAppOrRedirect(c.env, c.req.raw);
  }

  return authError(c, 401, "Unauthorized");
}

/**
 * Result of {@link resolveHostAdminScope}: either an unauthorized `response`,
 * or a successful scope describing how broadly the caller may act.
 *
 * SECURITY (#10/#25 cross-tenant session IDOR): a validly-sealed GUI session
 * only proves *some* user is authenticated — it is NOT host admin authority. So
 * the create / list gates must distinguish scopes rather than treat any valid
 * caller as an admin: `kind: "admin"` (admin bearer token / trusted-routed
 * dashboard proxy) may see all sessions and mint sessions for any owner, while
 * `kind: "gui"` may only see / create sessions bound to `guiSession`.
 */
export type HostAdminScope =
  | { response: Response }
  | { response: null; kind: "admin" }
  | { response: null; kind: "gui"; guiSession: GuiSession };

export async function resolveHostAdminScope(
  c: AppContext,
): Promise<HostAdminScope> {
  if (isTrustedTakosRoutedRequest(c)) return { response: null, kind: "admin" };

  const token = extractBearerToken(c);
  const expected = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (token && expected && constantTimeEqual(token, expected)) {
    return { response: null, kind: "admin" };
  }

  if (isGuiPath(new URL(c.req.url).pathname) && guiAppAuthRequired(c.env)) {
    const auth = await requireGuiAppAuth(c.env, c.req.raw);
    if (auth) return { response: auth };
    const guiSession = await readGuiSession(c.env, c.req.raw);
    if (!guiSession) return { response: authError(c, 401, "Unauthorized") };
    return { response: null, kind: "gui", guiSession };
  }

  if (!expected) {
    return {
      response: authError(c, 503, "Sandbox host auth token is not configured"),
    };
  }

  return { response: authError(c, 401, "Unauthorized") };
}

export async function requirePublishedMcpAuth(
  c: AppContext,
): Promise<Response | null> {
  const token = extractBearerToken(c);
  if (!token) return authError(c, 401, "Unauthorized");

  if (token.startsWith("taksrv_")) {
    if (!hasPublishedMcpInterfaceOAuth(c.env)) {
      return authError(c, 503, "Interface OAuth is not configured");
    }
    const authorization = await authorizeInterfaceOAuthBearer(
      c.req.raw,
      token,
      "mcp.invoke",
      {
        issuerUrl: c.env.OIDC_ISSUER_URL,
        expectedAudience: c.env.MCP_URL!,
        expectedWorkspaceId: c.env.APP_WORKSPACE_ID,
        expectedCapsuleId: c.env.APP_CAPSULE_ID,
      },
    );
    if (!authorization) return authError(c, 401, "Unauthorized");
    publishedMcpPrincipals.set(c, {
      kind: "interface_oauth",
      namespaceSeed: [
        "interface",
        c.env.OIDC_ISSUER_URL,
        authorization.workspaceId,
        authorization.capsuleId,
        authorization.interfaceBindingId,
        authorization.subject,
      ].join(":"),
      subject: authorization.subject,
      workspaceId: authorization.workspaceId,
      capsuleId: authorization.capsuleId,
      interfaceBindingId: authorization.interfaceBindingId,
    });
    return null;
  }

  const expected = resolvePublishedMcpAuthToken(c.env);
  if (!expected) {
    return authError(c, 503, "Direct MCP auth is not configured");
  }
  if (!constantTimeEqual(token, expected)) {
    return authError(c, 401, "Unauthorized");
  }
  publishedMcpPrincipals.set(c, { kind: "direct", namespaceSeed: token });
  return null;
}

export async function authorizeSessionAccess(
  c: AppContext,
  sessionId: string,
  stub: DurableObjectStub & SandboxSessionContainer,
): Promise<Response | null> {
  if (isTrustedTakosRoutedRequest(c)) return null;

  // Resolve the caller in a fixed order — admin token, then per-session proxy
  // token, then OIDC GUI session — and NEVER let a present-but-invalid
  // admin/proxy credential (e.g. a stale `takos_computer_admin_token` cookie
  // after server-side rotation) short-circuit a valid sealed GUI session. The
  // pre-fix code keyed the OIDC fall-through on `if (!token)`, so a stale admin
  // cookie made the same authenticated user get 401 on get/destroy/MCP while
  // still getting 200 on list/create.
  const token = extractBearerToken(c);
  const adminToken = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (token && adminToken && constantTimeEqual(token, adminToken)) return null;
  if (token) {
    const tokenInfo = await stub.verifyProxyToken(token);
    if (tokenInfo && tokenInfo.sessionId === sessionId) return null;
  }

  if (isGuiPath(new URL(c.req.url).pathname) && guiAppAuthRequired(c.env)) {
    // SECURITY (#10 cross-user RCE via session IDOR): a valid GUI session is
    // necessary but NOT sufficient — it must also own the *target* sandbox.
    const auth = await requireGuiAppAuth(c.env, c.req.raw);
    if (auth) return auth;
    const guiSession = await readGuiSession(c.env, c.req.raw);
    if (!guiSession) return authError(c, 401, "Unauthorized");
    // A GUI principal must never address a published-MCP-scoped session id,
    // even by guessing it: those sessions are owned by the agent runtime, not
    // a GUI user (reserved namespace, see `guiSessionOwnsSandbox`).
    if (isPublishedScopedId(sessionId)) return authError(c, 403, "Forbidden");
    const state = await stub.getSessionState();
    if (!state || !guiSessionOwnsSandbox(guiSession, state)) {
      return authError(c, 403, "Forbidden");
    }
    return null;
  }

  return authError(c, 401, "Unauthorized");
}
