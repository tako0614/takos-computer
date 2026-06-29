/**
 * Shared MCP Streamable-HTTP JSON-RPC envelope for takos-computer MCP servers.
 *
 * Both the in-container sandbox MCP server and the published (`/mcp`) host MCP
 * server speak the same JSON-RPC subset over Streamable HTTP: `initialize`,
 * `notifications/initialized`, `tools/list`, and `tools/call`. This module is
 * the single source for that envelope so the two servers stay byte-identical
 * on protocol shape and error codes; each server supplies only its tool set,
 * server identity, auth gate, and per-call context.
 *
 * Canonical error codes follow the JSON-RPC 2.0 spec; `tools/call` handler
 * failures use `-32603` (Internal error) on both servers.
 */

/** JSON-RPC error code used when a `tools/call` handler throws. */
export const MCP_TOOL_CALL_ERROR_CODE = -32603;

/** MCP protocol version advertised by both servers. */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonRpcResponse(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

export function jsonRpcError(
  id: unknown,
  code: number,
  message: string,
): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
}

/**
 * 405 response for non-POST/non-OPTIONS MCP requests. `endpointLabel`
 * disambiguates the body between the in-container sandbox endpoint and the
 * host-facing endpoint.
 */
export function mcpMethodNotAllowed(endpointLabel = "endpoint"): Response {
  return new Response(
    JSON.stringify({
      error:
        `MCP Streamable HTTP requests must use POST; server-to-client GET streams are not supported by this ${endpointLabel}`,
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

/** 204 preflight response for an MCP OPTIONS request. */
export function mcpOptionsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: { Allow: "POST, OPTIONS" },
  });
}

/** Result shape returned by an MCP tool handler. */
export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

/** Wrap a plain string in the MCP tool-result text envelope. */
export function mcpText(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

/** Wrap a value as a pretty-printed JSON MCP text result. */
export function mcpJson(value: unknown): McpToolResult {
  return mcpText(JSON.stringify(value, null, 2));
}

/** Minimal tool definition the envelope needs for list + dispatch. */
export type McpToolDefinition<TContext> = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handle: (args: Record<string, unknown>, context: TContext) => Promise<
    McpToolResult
  >;
};

export type McpEnvelopeConfig<TContext> = {
  serverInfo: { name: string; version: string };
  tools: ReadonlyArray<McpToolDefinition<TContext>>;
  toolMap: ReadonlyMap<string, McpToolDefinition<TContext>>;
  /**
   * Auth / preflight gate. Return a `Response` to short-circuit (e.g. 401/503),
   * or `null` to proceed. Must NOT handle OPTIONS/405 — the envelope does.
   */
  authorize: (request: Request) => Promise<Response | null> | Response | null;
  /** Build the per-call context handed to tool handlers. */
  callContext: (request: Request) => TContext;
  /** Label embedded in the 405 body (e.g. "sandbox endpoint"). */
  endpointLabel?: string;
};

/**
 * Cap on the JSON-RPC request body for ALL MCP entry points sharing this
 * envelope (published /mcp + the in-container sandbox endpoint), so neither
 * buffers an oversized body. Matches MAX_MCP_FORWARD_BODY_BYTES on the host
 * forward path. 1 MiB is far above any real MCP call.
 */
const MAX_MCP_BODY_BYTES = 1024 * 1024;

/**
 * Read the request body as text, bounded to `max` bytes. Returns `null` when the
 * body exceeds the cap (Content-Length fast-path + streaming check so a missing
 * Content-Length / chunked body cannot be buffered unbounded).
 */
async function readBodyTextBounded(
  request: Request,
  max: number,
): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > max) return null;
  if (!request.body) {
    const text = await request.text();
    return new TextEncoder().encode(text).length > max ? null : text;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/**
 * Build a `(Request) => Promise<Response>` handler implementing the shared MCP
 * Streamable-HTTP JSON-RPC envelope. The caller supplies tools, identity, an
 * auth gate, and a per-call context factory.
 */
export function createMcpEnvelope<TContext>(
  config: McpEnvelopeConfig<TContext>,
): (request: Request) => Promise<Response> {
  const { serverInfo, tools, toolMap, authorize, callContext } = config;
  const endpointLabel = config.endpointLabel ?? "endpoint";

  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return mcpOptionsPreflight();
    }
    if (request.method !== "POST") {
      return mcpMethodNotAllowed(endpointLabel);
    }

    const denied = await authorize(request);
    if (denied) return denied;

    const bodyText = await readBodyTextBounded(request, MAX_MCP_BODY_BYTES);
    if (bodyText === null) {
      return jsonRpcError(null, -32600, "Request body too large");
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return jsonRpcError(null, -32700, "Parse error");
    }

    if (!isRecord(body)) {
      return jsonRpcError(null, -32600, "Invalid Request");
    }

    const id = body.id;
    if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return jsonRpcError(id, -32600, "Invalid Request");
    }

    if (body.method === "initialize") {
      return jsonRpcResponse(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo,
      });
    }

    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 204 });
    }

    if (body.method === "tools/list") {
      return jsonRpcResponse(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    }

    if (body.method !== "tools/call") {
      return jsonRpcError(id, -32601, "Method not found");
    }

    if (!isRecord(body.params) || typeof body.params.name !== "string") {
      return jsonRpcError(id, -32602, "Invalid params");
    }

    const tool = toolMap.get(body.params.name);
    if (!tool) {
      return jsonRpcError(id, -32602, `Unknown tool: ${body.params.name}`);
    }

    const args = isRecord(body.params.arguments) ? body.params.arguments : {};
    try {
      return jsonRpcResponse(id, await tool.handle(args, callContext(request)));
    } catch (err) {
      return jsonRpcError(
        id,
        MCP_TOOL_CALL_ERROR_CODE,
        err instanceof Error ? err.message : String(err),
      );
    }
  };
}
