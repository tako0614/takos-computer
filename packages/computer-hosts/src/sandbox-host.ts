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

import { type Context, Hono } from "hono";
import { guiAppAuthRequired, registerGuiAuthRoutes } from "./app-auth.ts";
import { appHtml, styleCss } from "./gui/assets.ts";
import { computerIconSvg } from "./gui/icon.ts";
import {
  getDOStub,
  resolveContainerMcpAuthToken,
  SandboxSessionContainer,
} from "./sandbox-session-container.ts";
import {
  authError,
  authorizeGuiApp,
  authorizeSessionAccess,
  guiSessionOwnsSandbox,
  requireHostAdmin,
  resolveHostAdminScope,
  resolvePublishedMcpAuthToken,
} from "./sandbox-host-auth.ts";
import { handlePublishedMcp } from "./sandbox-host-published-mcp.ts";
import type {
  CreateSandboxSessionPayload,
  SandboxHostEnv,
  SandboxSessionState,
} from "./sandbox-session-types.ts";

export { SandboxSessionContainer };

// ---------------------------------------------------------------------------
// Environment types
// ---------------------------------------------------------------------------

type Env = SandboxHostEnv;
type AppContext = Context<{ Bindings: Env }>;
const MAX_MCP_FORWARD_BODY_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const app: Hono<{ Bindings: Env }> = new Hono<{ Bindings: Env }>();

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

function collectMissingRuntimeBindings(env: Env): string[] {
  const missing: string[] = [];
  if (!env.SANDBOX_CONTAINER) missing.push("SANDBOX_CONTAINER");
  if (!env.SANDBOX_HOST_AUTH_TOKEN) missing.push("SANDBOX_HOST_AUTH_TOKEN");
  if (!resolveContainerMcpAuthToken(env)) {
    missing.push("MCP_AUTH_TOKEN");
  }
  if (!resolvePublishedMcpAuthToken(env)) {
    missing.push("PUBLISHED_MCP_AUTH_TOKEN");
  }
  if (!env.SESSION_INDEX) missing.push("SESSION_INDEX");
  if (guiAppAuthRequired(env)) {
    for (
      const name of [
        "APP_SESSION_SECRET",
        "OIDC_ISSUER_URL",
        "OIDC_CLIENT_ID",
        "OIDC_CLIENT_SECRET",
        "ACCOUNTS_BASE_URL",
        "INSTALL_LAUNCH_INSTALLATION_ID",
        "INSTALL_LAUNCH_CONSUME_PATH",
      ] as const
    ) {
      if (!env[name]) missing.push(name);
    }
  }
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
registerGuiAuthRoutes(app);
app.get("/gui", serveGuiApp);
app.get("/gui/", serveGuiApp);

// ---------------------------------------------------------------------------
// GUI API — session list (called by the dashboard proxy)
// ---------------------------------------------------------------------------

async function listSessions(c: AppContext): Promise<Response> {
  // SECURITY (#25 cross-tenant session enumeration): the session index spans
  // every tenant, so a plain GUI session must not enumerate the whole index.
  // Only a true host admin (admin bearer token / trusted-routed dashboard
  // proxy) sees all sessions; a GUI caller is filtered to the sessions it owns.
  const scope = await resolveHostAdminScope(c);
  if (scope.response) return scope.response;

  const kv = c.env.SESSION_INDEX;
  if (!kv) return c.json({ sessions: [] });
  const list = await kv.list({ prefix: "session:" });
  const sessions: SandboxSessionState[] = [];
  for (const key of list.keys) {
    const val = await kv.get(key.name, { type: "json" }) as
      | SandboxSessionState
      | null;
    if (!val) continue;
    if (scope.kind === "gui" && !guiSessionOwnsSandbox(scope.guiSession, val)) {
      continue;
    }
    sessions.push(val);
  }
  return c.json({ sessions });
}

app.get("/gui/api/sessions", listSessions);
app.get("/gui/api/sandbox-sessions", listSessions);

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function createSession(c: AppContext): Promise<Response> {
  const auth = await requireHostAdmin(c);
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

app.all("/mcp", handlePublishedMcp);

function mcpMethodNotAllowed(): Response {
  return new Response(
    JSON.stringify({
      error:
        "MCP Streamable HTTP requests must use POST; server-to-client GET streams are not supported by this endpoint",
    }),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        Allow: "POST, OPTIONS",
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Session MCP — forward to container
// ---------------------------------------------------------------------------

async function forwardMcp(c: AppContext): Promise<Response> {
  if (c.req.raw.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { Allow: "POST, OPTIONS" },
    });
  }

  const sessionId = sessionIdParam(c);
  if (sessionId instanceof Response) return sessionId;
  const stub = getDOStub(c.env, sessionId);
  try {
    const auth = await authorizeSessionAccess(c, sessionId, stub);
    if (auth) return auth;

    if (c.req.raw.method !== "POST") {
      return mcpMethodNotAllowed();
    }

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
