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
 *
 * Session scoping: the published surface has no per-user principal — every
 * caller authenticates with the same shared `PUBLISHED_MCP_AUTH_TOKEN`. To
 * stop one token holder from addressing or destroying sessions created by a
 * holder of a *different* token, every caller-supplied `session_id` is
 * resolved into the namespace derived from the presented token
 * (`<tokenNamespace>:<logicalSessionId>`) before it is used to address a
 * Durable Object or KV index entry. A caller therefore can only ever reach
 * sessions under their own token's namespace; a raw `session_id` minted under
 * another token is unreachable because its namespace prefix cannot be forged
 * without that token. The caller-facing `session_id` reported back in tool
 * results stays the logical id the caller passed.
 */

import type { Context } from "hono";
import { createMcpEnvelope, isRecord } from "@takos-computer/common/mcp-rpc";
import type { DurableObjectStub } from "./cf-types.ts";
import {
  requirePublishedMcpAuth,
  resolvePublishedMcpAuthToken,
} from "./sandbox-host-auth.ts";
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
      const { state, sessionId } = await ensurePublishedMcpSession(c, args);
      return publishedMcpJson(toPublishedSessionState(state, sessionId));
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
      const { sessionId, scopedId } = await resolvePublishedMcpSessionArgs(
        c,
        args,
      );
      const state = await getDOStub(c.env, scopedId).getSessionState();
      return publishedMcpJson(
        state
          ? toPublishedSessionState(state, sessionId)
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
      const { sessionId, scopedId } = await resolvePublishedMcpSessionArgs(
        c,
        args,
      );
      await getDOStub(c.env, scopedId).destroySession();
      const kv = c.env.SESSION_INDEX;
      if (kv) await kv.delete(`session:${scopedId}`);
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

/**
 * Derive a stable, non-reversible namespace prefix from the presented auth
 * token. Sessions are addressed under this prefix so a token holder can only
 * reach their own sessions. Returns a hex SHA-256 prefix; throws (fail-closed)
 * if no token is configured — `requirePublishedMcpAuth` already rejects those
 * requests before tool handlers run, so this is a defensive guard.
 */
async function publishedMcpTokenNamespace(c: AppContext): Promise<string> {
  const token = resolvePublishedMcpAuthToken(c.env);
  if (!token) {
    throw new Error("Published MCP auth token is not configured");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `pmcp-${hex.slice(0, 16)}`;
}

type ResolvedPublishedMcpSession = {
  /** Logical session id the caller passed / sees in responses. */
  sessionId: string;
  /** Namespaced DO name + KV key — scoped to the caller's token. */
  scopedId: string;
  spaceId: string;
  userId: string;
};

async function resolvePublishedMcpSessionArgs(
  c: AppContext,
  args: Record<string, unknown>,
): Promise<ResolvedPublishedMcpSession> {
  const sessionId = nonEmptyStringArg(
    args,
    ["session_id", "sessionId"],
    PUBLISHED_MCP_DEFAULT_SESSION_ID,
  );
  const namespace = await publishedMcpTokenNamespace(c);
  return {
    sessionId,
    scopedId: `${namespace}:${sessionId}`,
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

function toPublishedSessionState(
  state: SandboxSessionState,
  /** Logical id to report; defaults to the stored (logical) sessionId. */
  logicalSessionId: string = state.sessionId,
): Record<string, unknown> {
  return {
    session_id: logicalSessionId,
    space_id: state.spaceId,
    user_id: state.userId,
    status: state.status,
    created_at: state.createdAt,
  };
}

async function indexPublishedMcpSession(
  c: AppContext,
  scopedId: string,
  state: SandboxSessionState,
): Promise<void> {
  const kv = c.env.SESSION_INDEX;
  if (!kv) return;
  // Index under the token-scoped id so sessions with the same logical id but
  // different token namespaces do not collide or leak across token holders.
  //
  // The Durable Object owning this session is addressed by `scopedId`, so the
  // stored `sessionId` must also be the `scopedId` rather than the logical id.
  // The admin GUI lists these entries and then drives get/destroy/viewer
  // through `/session/:id`, which addresses the DO by the raw id it was given;
  // if the stored id were the logical id, the admin would address a DO that
  // does not exist (404 on get, silent no-op on destroy) while the real scoped
  // session and its KV entry leaked. Storing the `scopedId` keeps the
  // list -> get -> destroy -> viewer round-trip pointing at the same DO/KV key
  // the published surface owns. The logical id is still what the published
  // caller sees in tool results (see `toPublishedSessionState`).
  const indexedState: SandboxSessionState = { ...state, sessionId: scopedId };
  await kv.put(`session:${scopedId}`, JSON.stringify(indexedState));
}

async function ensurePublishedMcpSession(
  c: AppContext,
  args: Record<string, unknown>,
): Promise<{
  stub: DurableObjectStub & SandboxSessionContainer;
  state: SandboxSessionState;
  sessionId: string;
}> {
  const { sessionId, scopedId, spaceId, userId } =
    await resolvePublishedMcpSessionArgs(c, args);
  const stub = getDOStub(c.env, scopedId);
  const existing = await stub.getSessionState();
  if (existing && existing.status !== "stopped") {
    return { stub, state: existing, sessionId };
  }

  // Store the logical sessionId in the session state/proxy token so the
  // caller-facing id is preserved; the DO is addressed by the scoped id.
  await stub.createSession({ sessionId, spaceId, userId });
  const state = await stub.getSessionState() ?? {
    sessionId,
    spaceId,
    userId,
    status: "active" as const,
    createdAt: new Date().toISOString(),
  };
  await indexPublishedMcpSession(c, scopedId, state);
  return { stub, state, sessionId };
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

export function handlePublishedMcp(c: AppContext): Promise<Response> {
  // The published tools need the Hono `AppContext`, so capture it as the
  // per-call context for this request. The shared envelope owns the
  // OPTIONS/405 preflight, JSON-RPC parsing/dispatch, and error codes; only
  // the auth gate, tool set, and identity are host-specific.
  const handle = createMcpEnvelope<AppContext>({
    serverInfo: { name: "takos-computer", version: "2.0.0" },
    tools: publishedMcpTools,
    toolMap: publishedMcpToolMap,
    authorize: () => requirePublishedMcpAuth(c),
    callContext: () => c,
  });
  return handle(c.req.raw);
}
