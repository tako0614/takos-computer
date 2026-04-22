/**
 * takos-sandbox-host Worker
 *
 * Hosts SandboxSessionContainer (CF Containers DO sidecar).
 * Public API surface: MCP (shell, filesystem, process tools) + session lifecycle.
 * All interaction goes through MCP tools.
 *
 * Architecture:
 *   client -> POST /session/:id/mcp -> this worker -> DO -> container /mcp
 */

import type { HostContainerInternals } from "./container-runtime.ts";
import { HostContainerRuntime } from "./container-runtime.ts";
import { type Context, Hono } from "hono";
import { generateProxyToken } from "./proxy-token.ts";
import { constantTimeEqual } from "./crypto-utils.ts";
import type { DurableObjectStub } from "./cf-types.ts";
import { appHtml, styleCss } from "./gui/assets.ts";
import { computerIconSvg } from "./gui/icon.ts";
import type {
  CreateSandboxSessionPayload,
  SandboxHostEnv,
  SandboxSessionState,
  SandboxSessionTokenInfo,
} from "./sandbox-session-types.ts";

// ---------------------------------------------------------------------------
// Environment types
// ---------------------------------------------------------------------------

type Env = SandboxHostEnv;
type AppContext = Context<{ Bindings: Env }>;
const MAX_MCP_FORWARD_BODY_BYTES = 1024 * 1024;
const PROXY_TOKENS_STORAGE_KEY = "proxyTokens";
const SESSION_STATE_STORAGE_KEY = "sessionState";
const GUI_ADMIN_COOKIE = "takos_computer_admin_token";
const GUI_PROXY_COOKIE = "takos_computer_proxy_token";
const GUI_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60;

function resolveContainerMcpAuthToken(env: Env): string | undefined {
  return env.MCP_AUTH_TOKEN || undefined;
}

// ---------------------------------------------------------------------------
// Durable Object — SandboxSessionContainer
// ---------------------------------------------------------------------------

export class SandboxSessionContainer extends HostContainerRuntime<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";
  pingEndpoint = "internal/healthz";

  private cachedTokens: Map<string, SandboxSessionTokenInfo> | null = null;
  private sessionState: SandboxSessionState | null = null;
  private proxyTokensLoaded = false;
  private sessionStateLoaded = false;

  private applyContainerEnv(): void {
    const nextEnvVars = { ...this.envVars };
    const mcpAuthToken = resolveContainerMcpAuthToken(this.env);
    if (mcpAuthToken) {
      nextEnvVars.MCP_AUTH_TOKEN = mcpAuthToken;
    } else {
      delete nextEnvVars.MCP_AUTH_TOKEN;
    }

    if (this.env.TAKOS_TOKEN) {
      nextEnvVars.TAKOS_TOKEN = this.env.TAKOS_TOKEN;
    } else {
      delete nextEnvVars.TAKOS_TOKEN;
    }

    if (this.env.TAKOS_API_URL) {
      nextEnvVars.TAKOS_API_URL = this.env.TAKOS_API_URL;
    } else {
      delete nextEnvVars.TAKOS_API_URL;
    }

    const spaceId = this.sessionState?.spaceId;
    if (spaceId) {
      nextEnvVars.TAKOS_SPACE_ID = spaceId;
    } else {
      delete nextEnvVars.TAKOS_SPACE_ID;
    }
    this.envVars = nextEnvVars;
  }

  private async ensureProxyTokensLoaded(): Promise<void> {
    if (this.proxyTokensLoaded) return;
    const stored = await this.ctx.storage.get<
      Record<string, SandboxSessionTokenInfo>
    >(PROXY_TOKENS_STORAGE_KEY);
    this.cachedTokens = stored ? new Map(Object.entries(stored)) : null;
    this.proxyTokensLoaded = true;
  }

  private async ensureSessionStateLoaded(): Promise<void> {
    if (this.sessionStateLoaded) return;
    this.sessionState = await this.ctx.storage.get<SandboxSessionState>(
      SESSION_STATE_STORAGE_KEY,
    ) ?? null;
    this.sessionStateLoaded = true;
  }

  private async persistProxyTokens(
    tokenMap: Record<string, SandboxSessionTokenInfo>,
  ): Promise<void> {
    await this.ctx.storage.put(PROXY_TOKENS_STORAGE_KEY, tokenMap);
    this.cachedTokens = new Map(Object.entries(tokenMap));
    this.proxyTokensLoaded = true;
  }

  private async persistSessionState(
    sessionState: SandboxSessionState,
  ): Promise<void> {
    await this.ctx.storage.put(SESSION_STATE_STORAGE_KEY, sessionState);
    this.sessionState = sessionState;
    this.sessionStateLoaded = true;
  }

  private async clearPersistedSession(): Promise<void> {
    this.cachedTokens = null;
    this.sessionState = null;
    this.proxyTokensLoaded = true;
    this.sessionStateLoaded = true;
    await Promise.all([
      this.ctx.storage.delete(PROXY_TOKENS_STORAGE_KEY),
      this.ctx.storage.delete(SESSION_STATE_STORAGE_KEY),
    ]);
  }

  async createSession(
    payload: CreateSandboxSessionPayload,
  ): Promise<{ ok: true; proxyToken: string }> {
    const proxyToken = generateProxyToken();
    const tokenInfo: SandboxSessionTokenInfo = {
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId,
    };

    const tokenMap: Record<string, SandboxSessionTokenInfo> = {
      [proxyToken]: tokenInfo,
    };
    const sessionState: SandboxSessionState = {
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId,
      status: "starting",
      createdAt: new Date().toISOString(),
    };
    await this.persistProxyTokens(tokenMap);
    await this.persistSessionState(sessionState);
    this.applyContainerEnv();

    try {
      await this.startAndWaitForPorts([8080]);
      const activeState: SandboxSessionState = {
        ...sessionState,
        status: "active",
      };
      await this.persistSessionState(activeState);
      return { ok: true, proxyToken };
    } catch (error) {
      await Promise.allSettled([this.clearPersistedSession(), this.destroy()]);
      throw error;
    }
  }

  async verifyProxyToken(
    token: string,
  ): Promise<SandboxSessionTokenInfo | null> {
    await this.ensureProxyTokensLoaded();
    if (!this.cachedTokens) return null;
    for (const [storedToken, info] of this.cachedTokens) {
      if (constantTimeEqual(token, storedToken)) return info;
    }
    return null;
  }

  async getSessionState(): Promise<SandboxSessionState | null> {
    await this.ensureSessionStateLoaded();
    return this.sessionState;
  }

  async destroySession(): Promise<void> {
    await this.ensureSessionStateLoaded();
    if (this.sessionState) {
      await this.persistSessionState({
        ...this.sessionState,
        status: "stopped",
      });
    }
    await this.clearPersistedSession();
    await this.destroy();
  }

  /** Forward an HTTP request to the container. */
  async forwardToContainer(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    await this.ensureSessionStateLoaded();
    this.applyContainerEnv();
    this.renewActivityTimeout();
    const tcpPort = (this as unknown as HostContainerInternals).container
      .getTcpPort(8080);
    const request = new Request(`http://internal${path}`, init);
    return tcpPort.fetch(request.url, request);
  }
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const app: Hono<{ Bindings: Env }> = new Hono<{ Bindings: Env }>();

function getDOStub(
  env: Env,
  sessionId: string,
): DurableObjectStub & SandboxSessionContainer {
  const id = env.SANDBOX_CONTAINER.idFromName(sessionId);
  return env.SANDBOX_CONTAINER.get(id) as unknown as
    & DurableObjectStub
    & SandboxSessionContainer;
}

function errorResponse(
  c: { json: (data: unknown, status: number) => Response },
  err: unknown,
): Response {
  return c.json(
    { error: err instanceof Error ? err.message : "Unknown error" },
    500,
  );
}

function sessionIdParam(c: AppContext): string | Response {
  const sessionId = c.req.param("id");
  if (!sessionId) return c.json({ error: "Missing session id" }, 400);
  return sessionId;
}

function extractBearerToken(c: AppContext): string | null {
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

function authError(c: AppContext, status: 401 | 403 | 503, message: string) {
  return c.json({ error: message }, status);
}

function isTrustedTakosRoutedRequest(c: AppContext): boolean {
  return c.env.TAKOS_TRUST_ROUTED_GUI_API === "1" &&
    c.req.header("X-Takos-Internal-Marker") === "1";
}

function isGuiPath(pathname: string): boolean {
  return pathname === "/gui" || pathname.startsWith("/gui/");
}

function getCookie(
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

async function authorizeGuiApp(c: AppContext): Promise<Response | null> {
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

  return authError(c, 401, "Unauthorized");
}

async function readRequestTextWithLimit(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: string } | { ok: false; response: Response }> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength) {
    const parsed = Number(contentLength);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return {
        ok: false,
        response: Response.json({ error: "Invalid Content-Length" }, {
          status: 400,
        }),
      };
    }
    if (parsed > maxBytes) {
      return {
        ok: false,
        response: Response.json({ error: "MCP request body too large" }, {
          status: 413,
        }),
      };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, body: "" };

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return {
        ok: false,
        response: Response.json({ error: "MCP request body too large" }, {
          status: 413,
        }),
      };
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      ok: true,
      body: new TextDecoder("utf-8", { fatal: true }).decode(body),
    };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid UTF-8 body" }, { status: 400 }),
    };
  }
}

function requireHostAdmin(c: AppContext): Response | null {
  if (isTrustedTakosRoutedRequest(c)) return null;

  const expected = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (!expected) {
    return authError(c, 503, "Sandbox host auth token is not configured");
  }

  const token = extractBearerToken(c);
  if (!token || !constantTimeEqual(token, expected)) {
    return authError(c, 401, "Unauthorized");
  }

  return null;
}

async function authorizeSessionAccess(
  c: AppContext,
  sessionId: string,
  stub: DurableObjectStub & SandboxSessionContainer,
): Promise<Response | null> {
  if (isTrustedTakosRoutedRequest(c)) return null;

  const token = extractBearerToken(c);
  if (!token) return authError(c, 401, "Unauthorized");

  const adminToken = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (adminToken && constantTimeEqual(token, adminToken)) return null;

  const tokenInfo = await stub.verifyProxyToken(token);
  if (!tokenInfo || tokenInfo.sessionId !== sessionId) {
    return authError(c, 401, "Unauthorized");
  }

  return null;
}

function collectMissingRuntimeBindings(env: Env): string[] {
  const missing: string[] = [];
  if (!env.SANDBOX_CONTAINER) missing.push("SANDBOX_CONTAINER");
  if (!env.SANDBOX_HOST_AUTH_TOKEN) missing.push("SANDBOX_HOST_AUTH_TOKEN");
  if (!resolveContainerMcpAuthToken(env)) {
    missing.push("MCP_AUTH_TOKEN");
  }
  if (!env.SESSION_INDEX) missing.push("SESSION_INDEX");
  return missing;
}

// Health
app.get("/healthz", (c) => {
  const missing = collectMissingRuntimeBindings(c.env);
  return c.json({
    status: "ok",
    service: "takos-sandbox-host",
    ready: missing.length === 0,
    missingBindings: missing,
  });
});

app.get("/health", (c) => {
  const missing = collectMissingRuntimeBindings(c.env);

  return c.json({
    status: missing.length === 0 ? "ok" : "misconfigured",
    service: "takos-sandbox-host",
    missingBindings: missing,
  }, missing.length === 0 ? 200 : 503);
});

app.get("/readyz", (c) => {
  const missing = collectMissingRuntimeBindings(c.env);
  return c.json({
    status: missing.length === 0 ? "ok" : "misconfigured",
    service: "takos-sandbox-host",
    missingBindings: missing,
  }, missing.length === 0 ? 200 : 503);
});

async function serveGuiApp(c: AppContext): Promise<Response> {
  const auth = await authorizeGuiApp(c);
  if (auth) return auth;

  return new Response(appHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function serveGuiStyle(): Response {
  return new Response(styleCss, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function serveComputerIcon(): Response {
  return new Response(computerIconSvg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

app.get("/icons/computer.svg", serveComputerIcon);
app.get("/gui/icons/computer.svg", serveComputerIcon);
app.get("/gui", serveGuiApp);
app.get("/gui/", serveGuiApp);

// ---------------------------------------------------------------------------
// GUI API — session list (called by the dashboard proxy)
// ---------------------------------------------------------------------------

async function listSessions(c: AppContext): Promise<Response> {
  const auth = requireHostAdmin(c);
  if (auth) return auth;

  const kv = c.env.SESSION_INDEX;
  if (!kv) return c.json({ sessions: [] });
  const list = await kv.list({ prefix: "session:" });
  const sessions: SandboxSessionState[] = [];
  for (const key of list.keys) {
    const val = await kv.get(key.name, { type: "json" }) as
      | SandboxSessionState
      | null;
    if (val) sessions.push(val);
  }
  return c.json({ sessions });
}

app.get("/gui/api/sessions", listSessions);
app.get("/gui/api/sandbox-sessions", listSessions);

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function createSession(c: AppContext): Promise<Response> {
  const auth = requireHostAdmin(c);
  if (auth) return auth;

  const payload = await c.req.json<CreateSandboxSessionPayload>();
  if (!payload.sessionId || !payload.spaceId || !payload.userId) {
    return c.json({
      error: "Missing required fields: sessionId, spaceId, userId",
    }, 400);
  }
  try {
    const stub = getDOStub(c.env, payload.sessionId);
    const result = await stub.createSession(payload);
    const state = await stub.getSessionState();
    const kv = c.env.SESSION_INDEX;
    if (kv && state) {
      await kv.put(`session:${payload.sessionId}`, JSON.stringify(state));
    }
    return c.json(result, 201);
  } catch (err) {
    return errorResponse(c, err);
  }
}

async function getSession(c: AppContext): Promise<Response> {
  const sessionId = sessionIdParam(c);
  if (sessionId instanceof Response) return sessionId;
  const stub = getDOStub(c.env, sessionId);
  const auth = await authorizeSessionAccess(c, sessionId, stub);
  if (auth) return auth;

  const state = await stub.getSessionState();
  if (!state) return c.json({ error: "Session not found" }, 404);
  return c.json(state);
}

async function destroySession(c: AppContext): Promise<Response> {
  const sessionId = sessionIdParam(c);
  if (sessionId instanceof Response) return sessionId;
  const stub = getDOStub(c.env, sessionId);
  try {
    const auth = await authorizeSessionAccess(c, sessionId, stub);
    if (auth) return auth;

    await stub.destroySession();
    const kv = c.env.SESSION_INDEX;
    if (kv) await kv.delete(`session:${sessionId}`);
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
}

app.post("/create", createSession);
app.post("/gui/api/sandbox-create", createSession);
app.get("/session/:id", getSession);
app.get("/gui/api/sandbox-session/:id", getSession);
app.delete("/session/:id", destroySession);
app.delete("/gui/api/sandbox-session/:id", destroySession);

// ---------------------------------------------------------------------------
// MCP — forward to container (sole API surface for tools)
// ---------------------------------------------------------------------------

async function forwardMcp(c: AppContext): Promise<Response> {
  const sessionId = sessionIdParam(c);
  if (sessionId instanceof Response) return sessionId;
  const stub = getDOStub(c.env, sessionId);
  try {
    const auth = await authorizeSessionAccess(c, sessionId, stub);
    if (auth) return auth;

    const mcpAuthToken = resolveContainerMcpAuthToken(c.env);
    if (!mcpAuthToken) {
      return authError(c, 503, "Sandbox MCP auth token is not configured");
    }
    const headers = new Headers();
    headers.set(
      "Content-Type",
      c.req.header("Content-Type") ?? "application/json",
    );
    headers.set("Authorization", `Bearer ${mcpAuthToken}`);
    const accept = c.req.header("Accept");
    if (accept) headers.set("Accept", accept);

    const init: RequestInit = {
      method: c.req.raw.method,
      headers,
      signal: c.req.raw.signal,
    };
    if (c.req.raw.method === "POST") {
      const body = await readRequestTextWithLimit(
        c.req.raw,
        MAX_MCP_FORWARD_BODY_BYTES,
      );
      if (!body.ok) return body.response;
      init.body = body.body;
    }

    const response = await stub.forwardToContainer("/mcp", init);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    return errorResponse(c, err);
  }
}

app.all("/session/:id/mcp", forwardMcp);
app.all("/gui/api/sandbox-session/:id/mcp", forwardMcp);
app.get("/gui/style.css", serveGuiStyle);
app.get("/gui/*", serveGuiApp);

export default {
  fetch: app.fetch,
};
