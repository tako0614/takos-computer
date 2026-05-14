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
 *      `POST /create` either as a Bearer token, an `X-Proxy-Token` header,
 *      or the `takos_computer_proxy_token` GUI cookie.
 *   3. Takosumi-routed GUI request — trusted iff
 *      `TAKOS_TRUST_ROUTED_GUI_API=1` and the `X-Takos-Internal-Marker: 1`
 *      header is set by the dashboard proxy. When configured, GUI requests
 *      can also fall back to the OIDC-backed GUI app session via
 *      `requireGuiAppAuth` / `requireGuiAppOrRedirect` from `app-auth.ts`.
 *
 * This module owns the token / cookie plumbing and the
 * `requireHostAdmin` / `authorizeSessionAccess` / `authorizeGuiApp` /
 * `requirePublishedMcpAuth` gates that the routes in `sandbox-host.ts`
 * compose. Cookie names, lifetimes, and query-param names are part of the
 * public surface and must stay in sync with the GUI assets.
 */

import type { Context } from "hono";
import {
  guiAppAuthRequired,
  requireGuiAppAuth,
  requireGuiAppOrRedirect,
} from "./app-auth.ts";
import { constantTimeEqual } from "./crypto-utils.ts";
import type { DurableObjectStub } from "./cf-types.ts";
import { getDOStub } from "./sandbox-session-container.ts";
import type { SandboxSessionContainer } from "./sandbox-session-container.ts";
import type { SandboxHostEnv } from "./sandbox-session-types.ts";

type Env = SandboxHostEnv;
type AppContext = Context<{ Bindings: Env }>;

export const GUI_ADMIN_COOKIE = "takos_computer_admin_token";
export const GUI_PROXY_COOKIE = "takos_computer_proxy_token";
export const GUI_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60;

export function resolvePublishedMcpAuthToken(env: Env): string | undefined {
  return env.PUBLISHED_MCP_AUTH_TOKEN || undefined;
}

export function authError(
  c: AppContext,
  status: 401 | 403 | 503,
  message: string,
): Response {
  return c.json({ error: message }, status);
}

export function isTrustedTakosRoutedRequest(c: AppContext): boolean {
  return c.env.TAKOS_TRUST_ROUTED_GUI_API === "1" &&
    c.req.header("X-Takos-Internal-Marker") === "1";
}

export function isGuiPath(pathname: string): boolean {
  return pathname === "/gui" || pathname.startsWith("/gui/");
}

export function getCookie(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== name || rawValue.length === 0) continue;
    const value = rawValue.join("=");
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
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
    return getCookie(c.req.header("Cookie"), GUI_ADMIN_COOKIE) ??
      getCookie(c.req.header("Cookie"), GUI_PROXY_COOKIE);
  }

  return null;
}

function buildAuthCookie(
  c: AppContext,
  name: string,
  value: string,
): string {
  const secure = new URL(c.req.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${
    encodeURIComponent(value)
  }; Path=/gui; Max-Age=${GUI_AUTH_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
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
      "Location": location,
      "Set-Cookie": buildAuthCookie(c, cookieName, token),
    },
  });
}

function validateHostAdminToken(
  c: AppContext,
  token: string,
): Response | null {
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

export async function authorizeGuiApp(
  c: AppContext,
): Promise<Response | null> {
  if (isTrustedTakosRoutedRequest(c)) return null;

  const url = new URL(c.req.url);
  const adminQueryToken = url.searchParams.get("authToken")?.trim() ||
    url.searchParams.get("hostToken")?.trim();
  if (adminQueryToken) {
    const auth = validateHostAdminToken(c, adminQueryToken);
    if (auth) return auth;
    return redirectWithoutGuiAuthQuery(c, GUI_ADMIN_COOKIE, adminQueryToken);
  }

  const sessionId = guiSessionIdFromPath(url.pathname);
  const adminCookie = getCookie(c.req.header("Cookie"), GUI_ADMIN_COOKIE);
  if (adminCookie) {
    const auth = validateHostAdminToken(c, adminCookie);
    if (!auth) return null;
  }

  const proxyCookie = getCookie(c.req.header("Cookie"), GUI_PROXY_COOKIE);
  if (proxyCookie && sessionId) {
    const auth = await validateSessionProxyToken(c, sessionId, proxyCookie);
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

export async function requireHostAdmin(
  c: AppContext,
): Promise<Response | null> {
  if (isTrustedTakosRoutedRequest(c)) return null;

  const token = extractBearerToken(c);
  const expected = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (token && expected && constantTimeEqual(token, expected)) {
    return null;
  }

  if (isGuiPath(new URL(c.req.url).pathname) && guiAppAuthRequired(c.env)) {
    const auth = await requireGuiAppAuth(c.env, c.req.raw);
    if (!auth) return null;
    return auth;
  }

  if (!expected) {
    return authError(c, 503, "Sandbox host auth token is not configured");
  }

  return authError(c, 401, "Unauthorized");
}

export function requirePublishedMcpAuth(c: AppContext): Response | null {
  const expected = resolvePublishedMcpAuthToken(c.env);
  if (!expected) {
    return authError(c, 503, "Published MCP auth token is not configured");
  }

  const token = extractBearerToken(c);
  if (!token || !constantTimeEqual(token, expected)) {
    return authError(c, 401, "Unauthorized");
  }

  return null;
}

export async function authorizeSessionAccess(
  c: AppContext,
  sessionId: string,
  stub: DurableObjectStub & SandboxSessionContainer,
): Promise<Response | null> {
  if (isTrustedTakosRoutedRequest(c)) return null;

  const token = extractBearerToken(c);
  if (!token) {
    if (isGuiPath(new URL(c.req.url).pathname) && guiAppAuthRequired(c.env)) {
      return await requireGuiAppAuth(c.env, c.req.raw);
    }
    return authError(c, 401, "Unauthorized");
  }

  const adminToken = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (adminToken && constantTimeEqual(token, adminToken)) return null;

  const tokenInfo = await stub.verifyProxyToken(token);
  if (!tokenInfo || tokenInfo.sessionId !== sessionId) {
    return authError(c, 401, "Unauthorized");
  }

  return null;
}
