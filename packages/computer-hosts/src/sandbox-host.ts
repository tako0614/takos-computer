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
import type { DurableObjectStub } from "./cf-types.ts";
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
  requireHostAdmin,
  requirePublishedMcpAuth,
  resolvePublishedMcpAuthToken,
} from "./sandbox-host-auth.ts";
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
const PUBLISHED_MCP_DEFAULT_SESSION_ID = "agent-default";
const PUBLISHED_MCP_DEFAULT_SPACE_ID = "published-mcp";
const PUBLISHED_MCP_DEFAULT_USER_ID = "takos-agent";

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type PublishedMcpToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

type PublishedMcpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handle: (
    args: Record<string, unknown>,
    c: AppContext,
  ) => Promise<PublishedMcpToolResult>;
};

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
  const auth = await requireHostAdmin(c);
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

// ---------------------------------------------------------------------------
// Published MCP — stable agent-facing MCP surface
// ---------------------------------------------------------------------------

const publishedSessionInputProperties: Record<string, unknown> = {
  session_id: {
    type: "string",
    description:
      "Sandbox session id. Omit to use the default agent session, or pass the id returned by computer_session_create.",
  },
  space_id: {
    type: "string",
    description:
      "Space id used when creating a new sandbox session. Optional for the default agent session.",
  },
  user_id: {
    type: "string",
    description:
      "User id used when creating a new sandbox session. Optional for the default agent session.",
  },
};

const publishedMcpTools: PublishedMcpToolDefinition[] = [
  {
    name: "computer_session_create",
    description:
      "Create or reuse a takos-computer sandbox session. Use this before multi-step computer work when you want an explicit session id.",
    inputSchema: {
      type: "object",
      properties: publishedSessionInputProperties,
    },
    handle: async (args, c) => {
      const { state } = await ensurePublishedMcpSession(c, args);
      return publishedMcpJson(toPublishedSessionState(state));
    },
  },
  {
    name: "computer_session_status",
    description: "Get the current state for a takos-computer sandbox session.",
    inputSchema: {
      type: "object",
      properties: publishedSessionInputProperties,
    },
    handle: async (args, c) => {
      const { sessionId } = resolvePublishedMcpSessionArgs(args);
      const state = await getDOStub(c.env, sessionId).getSessionState();
      return publishedMcpJson(
        state
          ? toPublishedSessionState(state)
          : { session_id: sessionId, status: "missing" },
      );
    },
  },
  {
    name: "computer_session_destroy",
    description:
      "Destroy a takos-computer sandbox session and remove it from the session index.",
    inputSchema: {
      type: "object",
      properties: publishedSessionInputProperties,
    },
    handle: async (args, c) => {
      const { sessionId } = resolvePublishedMcpSessionArgs(args);
      await getDOStub(c.env, sessionId).destroySession();
      const kv = c.env.SESSION_INDEX;
      if (kv) await kv.delete(`session:${sessionId}`);
      return publishedMcpJson({ ok: true, session_id: sessionId });
    },
  },
  {
    name: "computer_shell_exec",
    description:
      "Execute a shell command in a takos-computer sandbox. Automatically creates the sandbox session if needed.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        command: { type: "string", description: "Shell command to execute." },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds. Default: 30000.",
        },
        cwd: { type: "string", description: "Working directory." },
        env: {
          type: "object",
          description: "Additional environment variables.",
          additionalProperties: { type: "string" },
        },
        allow_takos_token: {
          type: "boolean",
          description:
            "Set to true to include TAKOS_TOKEN in the child process environment.",
        },
        takos_token: {
          type: "string",
          description:
            "Optional explicit TAKOS token to pass instead of the container token.",
        },
      },
      required: ["command"],
    },
    handle: (args, c) =>
      callSandboxToolThroughPublishedMcp(
        c,
        "shell_exec",
        args,
      ),
  },
  {
    name: "computer_file_read",
    description: "Read a file from the takos-computer sandbox workspace.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        path: {
          type: "string",
          description:
            "Workspace-relative path or absolute path inside /home/sandbox/workspace.",
        },
        offset: { type: "number", description: "Byte offset to start at." },
        limit: { type: "number", description: "Maximum bytes to read." },
        encoding: {
          type: "string",
          enum: ["utf-8", "base64"],
          description: "Output encoding. Default: utf-8.",
        },
      },
      required: ["path"],
    },
    handle: (args, c) =>
      callSandboxToolThroughPublishedMcp(
        c,
        "file_read",
        args,
      ),
  },
  {
    name: "computer_file_write",
    description: "Write a file in the takos-computer sandbox workspace.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        path: {
          type: "string",
          description:
            "Workspace-relative path or absolute path inside /home/sandbox/workspace.",
        },
        content: { type: "string", description: "Content to write." },
        encoding: {
          type: "string",
          enum: ["utf-8", "base64"],
          description: "Input encoding. Default: utf-8.",
        },
        create_dirs: {
          type: "boolean",
          description: "Create parent directories if missing.",
        },
      },
      required: ["path", "content"],
    },
    handle: (args, c) =>
      callSandboxToolThroughPublishedMcp(
        c,
        "file_write",
        args,
      ),
  },
  {
    name: "computer_file_list",
    description: "List files in the takos-computer sandbox workspace.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        path: {
          type: "string",
          description:
            "Workspace-relative directory path or absolute path inside /home/sandbox/workspace.",
        },
        recursive: {
          type: "boolean",
          description: "Recurse into subdirectories.",
        },
        glob: {
          type: "string",
          description: 'Filter entries by glob pattern, for example "*.ts".',
        },
      },
      required: ["path"],
    },
    handle: (args, c) =>
      callSandboxToolThroughPublishedMcp(
        c,
        "file_list",
        args,
      ),
  },
  {
    name: "computer_file_info",
    description:
      "Get metadata for a file or directory in the takos-computer sandbox workspace.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        path: {
          type: "string",
          description:
            "Workspace-relative path or absolute path inside /home/sandbox/workspace.",
        },
      },
      required: ["path"],
    },
    handle: (args, c) =>
      callSandboxToolThroughPublishedMcp(
        c,
        "file_info",
        args,
      ),
  },
  {
    name: "computer_process_list",
    description: "List running processes in the takos-computer sandbox.",
    inputSchema: {
      type: "object",
      properties: publishedSessionInputProperties,
    },
    handle: (args, c) =>
      callSandboxToolThroughPublishedMcp(
        c,
        "process_list",
        args,
      ),
  },
  {
    name: "computer_process_kill",
    description:
      "Kill a process tracked by the takos-computer sandbox shell manager.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        pid: { type: "number", description: "Process ID to kill." },
        signal: {
          type: "string",
          description: "Signal name. Default: SIGTERM.",
        },
      },
      required: ["pid"],
    },
    handle: (args, c) =>
      callSandboxToolThroughPublishedMcp(
        c,
        "process_kill",
        args,
      ),
  },
];

const publishedMcpToolMap = new Map(
  publishedMcpTools.map((tool) => [tool.name, tool]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRpcResponse(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function jsonRpcError(id: unknown, code: number, message: string): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
}

function publishedMcpJson(value: unknown): PublishedMcpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function nonEmptyStringArg(
  args: Record<string, unknown>,
  names: string[],
  fallback: string,
): string {
  for (const name of names) {
    const value = args[name];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return fallback;
}

function resolvePublishedMcpSessionArgs(args: Record<string, unknown>): {
  sessionId: string;
  spaceId: string;
  userId: string;
} {
  return {
    sessionId: nonEmptyStringArg(
      args,
      ["session_id", "sessionId"],
      PUBLISHED_MCP_DEFAULT_SESSION_ID,
    ),
    spaceId: nonEmptyStringArg(
      args,
      ["space_id", "spaceId"],
      PUBLISHED_MCP_DEFAULT_SPACE_ID,
    ),
    userId: nonEmptyStringArg(
      args,
      ["user_id", "userId"],
      PUBLISHED_MCP_DEFAULT_USER_ID,
    ),
  };
}

function stripPublishedMcpSessionArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const stripped = { ...args };
  for (
    const key of [
      "session_id",
      "sessionId",
      "space_id",
      "spaceId",
      "user_id",
      "userId",
    ]
  ) {
    delete stripped[key];
  }
  return stripped;
}

function toPublishedSessionState(state: SandboxSessionState): Record<
  string,
  unknown
> {
  return {
    session_id: state.sessionId,
    space_id: state.spaceId,
    user_id: state.userId,
    status: state.status,
    created_at: state.createdAt,
  };
}

async function indexPublishedMcpSession(
  c: AppContext,
  state: SandboxSessionState,
): Promise<void> {
  const kv = c.env.SESSION_INDEX;
  if (kv) await kv.put(`session:${state.sessionId}`, JSON.stringify(state));
}

async function ensurePublishedMcpSession(
  c: AppContext,
  args: Record<string, unknown>,
): Promise<{
  stub: DurableObjectStub & SandboxSessionContainer;
  state: SandboxSessionState;
}> {
  const { sessionId, spaceId, userId } = resolvePublishedMcpSessionArgs(args);
  const stub = getDOStub(c.env, sessionId);
  const existing = await stub.getSessionState();
  if (existing && existing.status !== "stopped") {
    return { stub, state: existing };
  }

  await stub.createSession({ sessionId, spaceId, userId });
  const state = await stub.getSessionState() ?? {
    sessionId,
    spaceId,
    userId,
    status: "active" as const,
    createdAt: new Date().toISOString(),
  };
  await indexPublishedMcpSession(c, state);
  return { stub, state };
}

async function callSandboxToolThroughPublishedMcp(
  c: AppContext,
  targetToolName: string,
  args: Record<string, unknown>,
): Promise<PublishedMcpToolResult> {
  const { stub } = await ensurePublishedMcpSession(c, args);
  const mcpAuthToken = resolveContainerMcpAuthToken(c.env);
  if (!mcpAuthToken) {
    throw new Error("Sandbox MCP auth token is not configured");
  }

  const response = await stub.forwardToContainer("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${mcpAuthToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "published-mcp-call",
      method: "tools/call",
      params: {
        name: targetToolName,
        arguments: stripPublishedMcpSessionArgs(args),
      },
    }),
    signal: c.req.raw.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Sandbox MCP HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Sandbox MCP returned non-JSON response");
  }
  if (!isRecord(payload)) {
    throw new Error("Sandbox MCP returned invalid response");
  }
  if (isRecord(payload.error)) {
    const message = typeof payload.error.message === "string"
      ? payload.error.message
      : JSON.stringify(payload.error);
    throw new Error(message);
  }
  const result = payload.result;
  if (
    isRecord(result) && Array.isArray(result.content) &&
    result.content.every((item) =>
      isRecord(item) && item.type === "text" && typeof item.text === "string"
    )
  ) {
    return result as PublishedMcpToolResult;
  }
  return publishedMcpJson(result ?? null);
}

async function handlePublishedMcp(c: AppContext): Promise<Response> {
  if (c.req.raw.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { Allow: "POST, OPTIONS" },
    });
  }
  if (c.req.raw.method !== "POST") {
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

  const auth = requirePublishedMcpAuth(c);
  if (auth) return auth;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  if (!isRecord(body)) return jsonRpcError(null, -32600, "Invalid Request");
  const request = body as JsonRpcRequest;
  const id = request.id;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return jsonRpcError(id, -32600, "Invalid Request");
  }

  if (request.method === "initialize") {
    return jsonRpcResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "takos-computer",
        version: "2.0.0",
      },
    });
  }

  if (request.method === "notifications/initialized") {
    return new Response(null, { status: 204 });
  }

  if (request.method === "tools/list") {
    return jsonRpcResponse(id, {
      tools: publishedMcpTools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    });
  }

  if (request.method !== "tools/call") {
    return jsonRpcError(id, -32601, "Method not found");
  }
  if (!isRecord(request.params) || typeof request.params.name !== "string") {
    return jsonRpcError(id, -32602, "Invalid params");
  }

  const tool = publishedMcpToolMap.get(request.params.name);
  if (!tool) {
    return jsonRpcError(id, -32602, `Unknown tool: ${request.params.name}`);
  }

  try {
    const args = isRecord(request.params.arguments)
      ? request.params.arguments
      : {};
    return jsonRpcResponse(id, await tool.handle(args, c));
  } catch (error) {
    return jsonRpcError(
      id,
      -32000,
      error instanceof Error ? error.message : String(error),
    );
  }
}

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
