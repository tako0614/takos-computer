/**
 * Published MCP — the stable, agent-facing MCP surface exposed at `/mcp`.
 *
 * Unlike `/session/:id/mcp`, which is a transparent passthrough to the
 * sandbox container, the published MCP layer:
 *
 *   - is namespaced (`computer_*` tool names) and rewrites them onto the
 *     container's internal tool names (`shell_exec`, `file_read`, ...)
 *   - auto-creates and indexes a default sandbox session if none exists
 *   - serves a Streamable HTTP JSON-RPC envelope (`initialize`,
 *     `tools/list`, `tools/call`, `notifications/initialized`)
 *
 * Auth: callers present `PUBLISHED_MCP_AUTH_TOKEN` as a Bearer token; the
 * gate lives in `sandbox-host-auth.ts`.
 */

import type { Context } from "hono";
import type { DurableObjectStub } from "./cf-types.ts";
import { requirePublishedMcpAuth } from "./sandbox-host-auth.ts";
import {
  getDOStub,
  resolveContainerMcpAuthToken,
} from "./sandbox-session-container.ts";
import type { SandboxSessionContainer } from "./sandbox-session-container.ts";
import type {
  SandboxHostEnv,
  SandboxSessionState,
} from "./sandbox-session-types.ts";

type Env = SandboxHostEnv;
type AppContext = Context<{ Bindings: Env }>;

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

export async function handlePublishedMcp(c: AppContext): Promise<Response> {
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
