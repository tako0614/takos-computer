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
import {
  MAX_MCP_BODY_BYTES,
  mcpMethodNotAllowed,
  mcpOptionsPreflight,
} from "@takos-computer/common/mcp-rpc";
import { guiAppAuthRequired, registerGuiAuthRoutes } from "./app-auth.ts";
import { appHtml } from "./gui/assets.ts";
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
  resolveHostAdminScope,
  resolvePublishedMcpAuthToken,
  hasPublishedMcpInterfaceOAuth,
} from "./sandbox-host-auth.ts";
import { handlePublishedMcp } from "./sandbox-host-published-mcp.ts";
import {
  countOwnerSessions,
  indexSession,
  listSessionStates,
  ownerIndexPrefix,
  SESSION_INDEX_GLOBAL_PREFIX,
  unindexSession,
} from "./session-index.ts";
import {
  isPublishedScopedId,
  PUBLISHED_MCP_SCOPE_PREFIX,
  type CreateSandboxSessionPayload,
  type SandboxHostEnv,
} from "./sandbox-session-types.ts";

export { SandboxSessionContainer };

// ---------------------------------------------------------------------------
// Environment types
// ---------------------------------------------------------------------------

type Env = SandboxHostEnv;
type AppContext = Context<{ Bindings: Env }>;

// Default cap on the number of live sandbox sessions a single GUI principal may
// own. Each session is its own Durable Object + CF container that lingers for
// `sleepAfter` (10m), and the container class is globally capped
// (maxInstances). Without a per-user bound, one authenticated user could
// exhaust the shared pool and deny the app to every other tenant.
const DEFAULT_MAX_SESSIONS_PER_USER = 10;

function maxSessionsPerUser(env: Env): number {
  const raw = env.MAX_SANDBOX_SESSIONS_PER_USER;
  if (!raw) return DEFAULT_MAX_SESSIONS_PER_USER;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_SESSIONS_PER_USER;
}

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
        response: Response.json(
          { error: "Invalid Content-Length" },
          {
            status: 400,
          },
        ),
      };
    }
    if (parsed > maxBytes) {
      return {
        ok: false,
        response: Response.json(
          { error: "MCP request body too large" },
          {
            status: 413,
          },
        ),
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
        response: Response.json(
          { error: "MCP request body too large" },
          {
            status: 413,
          },
        ),
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
  if (
    !resolvePublishedMcpAuthToken(env) &&
    !hasPublishedMcpInterfaceOAuth(env)
  ) {
    missing.push("PUBLISHED_MCP_AUTH_TOKEN or Interface OAuth configuration");
  }
  if (!env.SESSION_INDEX) missing.push("SESSION_INDEX");
  if (guiAppAuthRequired(env)) {
    for (const name of [
      "APP_SESSION_SECRET",
      "OIDC_ISSUER_URL",
      "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET",
    ] as const) {
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

function readinessResponse(c: AppContext): Response {
  const missing = collectMissingRuntimeBindings(c.env);
  return c.json(
    {
      status: missing.length === 0 ? "ok" : "misconfigured",
      service: "takos-sandbox-host",
      missingBindings: missing,
    },
    missing.length === 0 ? 200 : 503,
  );
}

app.get("/health", readinessResponse);
app.get("/readyz", readinessResponse);

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
  // A GUI caller lists only its own owner-scoped prefix (so it never reads
  // other tenants' state); an admin lists the whole index. Both follow the KV
  // cursor so entries past the first page are not silently dropped.
  const prefix =
    scope.kind === "gui"
      ? ownerIndexPrefix(scope.guiSession.sub)
      : SESSION_INDEX_GLOBAL_PREFIX;
  const all = await listSessionStates(kv, prefix);
  const sessions =
    scope.kind === "gui"
      ? all.filter((val) => guiSessionOwnsSandbox(scope.guiSession, val))
      : all;
  return c.json({ sessions });
}

app.get("/gui/api/sessions", listSessions);
app.get("/gui/api/sandbox-sessions", listSessions);

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function createSession(c: AppContext): Promise<Response> {
  // SECURITY (#10/#25 cross-tenant session IDOR): the create gate must resolve
  // *who* the caller is, not just that they are authenticated. A host admin /
  // trusted-routed dashboard proxy may mint a session for any owner, but a
  // plain GUI caller must only ever create sessions owned by themselves — the
  // client-supplied `userId`/`spaceId` are untrusted for the GUI scope.
  const scope = await resolveHostAdminScope(c);
  if (scope.response) return scope.response;

  const payload = await c.req.json<CreateSandboxSessionPayload>();
  let { sessionId, spaceId, userId } = payload;

  if (scope.kind === "gui") {
    // Force BOTH owner fields to the sealed session; never trust client claims.
    // spaceId is set authoritatively even when the session carries no space
    // claim (-> ""), so a space-less GUI session can't let a client-supplied
    // spaceId survive into SandboxSessionState / TAKOS_SPACE_ID and spoof the
    // space context the sandbox advertises to the Takos runtime.
    userId = scope.guiSession.sub;
    spaceId = scope.guiSession.spaceId ?? "";
  }

  // A non-empty spaceId is only demanded of admin / trusted-routed callers (who
  // supply it explicitly); a GUI caller's space is derived above and may be
  // legitimately empty for a space-less session.
  if (!sessionId || !userId || (scope.kind !== "gui" && !spaceId)) {
    return c.json(
      {
        error: "Missing required fields: sessionId, spaceId, userId",
      },
      400,
    );
  }

  // The `pmcp-` id namespace is reserved for published-MCP sessions, which a
  // GUI principal can never own (see guiSessionOwnsSandbox). Reject it here so a
  // caller cannot create a session it would then be unable to access.
  if (isPublishedScopedId(sessionId)) {
    return c.json(
      {
        error: `sessionId must not start with "${PUBLISHED_MCP_SCOPE_PREFIX}"`,
      },
      400,
    );
  }

  try {
    const kv = c.env.SESSION_INDEX;
    // A GUI caller must not address (and thereby clobber) a `sessionId` that is
    // already owned by a different principal.
    if (scope.kind === "gui") {
      const existing = await getDOStub(c.env, sessionId).getSessionState();
      if (existing && !guiSessionOwnsSandbox(scope.guiSession, existing)) {
        return c.json(
          { error: "Session id is owned by another principal" },
          409,
        );
      }
      // Quota: only new sessions count against the per-user cap (re-creating /
      // reusing one the caller already owns is fine).
      if (!existing && kv) {
        const owned = await countOwnerSessions(kv, userId);
        if (owned >= maxSessionsPerUser(c.env)) {
          return c.json({ error: "Active sandbox session limit reached" }, 429);
        }
      }
    }

    const stub = getDOStub(c.env, sessionId);
    const result = await stub.createSession({ sessionId, spaceId, userId });
    const state = await stub.getSessionState();
    if (kv && state) {
      try {
        await indexSession(kv, state);
      } catch (indexErr) {
        // The container + DO are already live; without an index entry the
        // session would be invisible/unmanageable (orphaned slot). Compensate
        // by tearing it down so the caller gets a clean failure to retry.
        await stub.destroySession().catch(() => {});
        throw indexErr;
      }
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

    // Load the owner-bearing state before tearing the session down so the
    // owner-scoped index key can be computed (the index keys by owner+id).
    const state = await stub.getSessionState();
    await stub.destroySession();
    const kv = c.env.SESSION_INDEX;
    if (kv) {
      await unindexSession(kv, {
        userId: state?.userId ?? "",
        sessionId,
      });
    }
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

// ---------------------------------------------------------------------------
// Session MCP — forward to container
// ---------------------------------------------------------------------------

async function forwardMcp(c: AppContext): Promise<Response> {
  if (c.req.raw.method === "OPTIONS") {
    return mcpOptionsPreflight();
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
        MAX_MCP_BODY_BYTES,
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
app.get("/gui/*", serveGuiApp);

export default {
  fetch: app.fetch,
};
