/**
 * MCP Server for Linux sandbox tools.
 *
 * Exposes:
 * - shell_exec    — Execute shell commands
 * - file_read     — Read file contents
 * - file_write    — Write file contents
 * - file_list     — List directory entries
 * - file_info     — Get file/directory metadata
 * - process_list  — List running processes
 * - process_kill  — Kill a process
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ProcessSignal,
  ShellExecOptions,
  ShellManager,
} from "./shell-manager.ts";
import type {
  FileListOptions,
  FileReadOptions,
  FileWriteOptions,
  FsManager,
} from "./fs-manager.ts";

export interface McpServerDeps {
  shell: ShellManager;
  fs: FsManager;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

type ToolContext = {
  signal: AbortSignal;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handle: (args: unknown, context: ToolContext) => Promise<ToolResult>;
};

export type McpRequestHandler = (request: Request) => Promise<Response>;

function text(s: string): ToolResult {
  return {
    content: [{ type: "text", text: s }],
  };
}

function json(v: unknown): ToolResult {
  return text(JSON.stringify(v, null, 2));
}

function errorText(err: unknown): ToolResult {
  return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectArgs(args: unknown): Record<string, unknown> {
  return isRecord(args) ? args : {};
}

function constantTimeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

function createSandboxToolDefinitions(deps: McpServerDeps): ToolDefinition[] {
  const { shell, fs } = deps;

  return [
    {
      name: "shell_exec",
      description:
        "Execute a shell command (bash -c). Returns stdout, stderr, and exit code.",
      inputSchema: { type: "object" },
      handle: (args, context) =>
        shell.exec({
          ...objectArgs(args),
          signal: context.signal,
        } as ShellExecOptions).then(json),
    },
    {
      name: "file_read",
      description:
        "Read file contents. Returns content, size, and truncation status.",
      inputSchema: { type: "object" },
      handle: async (args, context) => {
        try {
          return json(await fs.read(args as FileReadOptions, context.signal));
        } catch (err) {
          return errorText(err);
        }
      },
    },
    {
      name: "file_write",
      description:
        "Write content to a file. Creates the file if it does not exist.",
      inputSchema: { type: "object" },
      handle: async (args) => {
        try {
          return json(await fs.write(args as FileWriteOptions));
        } catch (err) {
          return errorText(err);
        }
      },
    },
    {
      name: "file_list",
      description:
        "List directory contents. Returns name, type, size, and modification time.",
      inputSchema: { type: "object" },
      handle: async (args) => {
        try {
          return json({ entries: await fs.list(args as FileListOptions) });
        } catch (err) {
          return errorText(err);
        }
      },
    },
    {
      name: "file_info",
      description:
        "Get file or directory metadata: existence, type, size, modification time, permissions.",
      inputSchema: { type: "object" },
      handle: async (args) => {
        try {
          if (!isRecord(args)) {
            throw new Error("arguments must be an object");
          }
          if (typeof args.path !== "string") {
            throw new Error("path must be a string");
          }
          return json(await fs.info(args.path));
        } catch (err) {
          return errorText(err);
        }
      },
    },
    {
      name: "process_list",
      description: "List running processes (via ps aux).",
      inputSchema: { type: "object" },
      handle: async () => {
        const result = await shell.exec({
          command: "ps aux --no-headers",
          timeout_ms: 5000,
        });
        if (result.exit_code !== 0) return text(`Error: ${result.stderr}`);

        const processes = result.stdout.trim().split("\n").filter(Boolean).map(
          (line) => {
            const parts = line.trim().split(/\s+/);
            return {
              user: parts[0],
              pid: parseInt(parts[1], 10),
              cpu: parts[2],
              mem: parts[3],
              command: parts.slice(10).join(" "),
            };
          },
        );
        return json({ processes });
      },
    },
    {
      name: "process_kill",
      description:
        "Kill a process by PID if ShellManager is tracking it. Sends SIGTERM by default.",
      inputSchema: { type: "object" },
      handle: (args) => {
        if (!isRecord(args)) {
          throw new Error("arguments must be an object");
        }
        if (typeof args.pid !== "number") {
          throw new Error("pid must be a number");
        }
        const signal = typeof args.signal === "string"
          ? args.signal
          : "SIGTERM";
        return Promise.resolve(json(
          shell.killProcess(args.pid, signal as ProcessSignal),
        ));
      },
    },
  ];
}

export function createSandboxMcpServer(deps: McpServerDeps): McpServer {
  const tools = createSandboxToolDefinitions(deps);
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const callTool = (name: string, args: unknown) => {
    const tool = toolMap.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.handle(args, { signal: new AbortController().signal });
  };

  const server = new McpServer({
    name: "takos-computer-sandbox",
    version: "1.0.0",
  });

  // ---------------------------------------------------------------------------
  // Shell tools
  // ---------------------------------------------------------------------------

  server.tool(
    "shell_exec",
    "Execute a shell command (bash -c). Returns stdout, stderr, and exit code.",
    {
      command: z.string().describe("Shell command to execute"),
      timeout_ms: z.number().optional().describe(
        "Timeout in milliseconds (default: 30000)",
      ),
      cwd: z.string().optional().describe("Working directory"),
      env: z.record(z.string()).optional().describe(
        "Additional environment variables",
      ),
      allow_takos_token: z.boolean().optional().describe(
        "Set to true to include TAKOS_TOKEN in the child process environment",
      ),
      takos_token: z.string().optional().describe(
        "Optional explicit TAKOS token to pass instead of the container token",
      ),
    },
    (args: ShellExecOptions) => callTool("shell_exec", args),
  );

  // ---------------------------------------------------------------------------
  // Filesystem tools
  // ---------------------------------------------------------------------------

  server.tool(
    "file_read",
    "Read file contents. Returns content, size, and truncation status.",
    {
      path: z.string().describe(
        "Workspace-relative path or absolute path inside /home/sandbox/workspace",
      ),
      offset: z.number().optional().describe(
        "Byte offset to start reading from",
      ),
      limit: z.number().optional().describe(
        "Max bytes to read (default/max: 256KB)",
      ),
      encoding: z.enum(["utf-8", "base64"]).optional().describe(
        "Output encoding (default: utf-8)",
      ),
    },
    (args: FileReadOptions) => callTool("file_read", args),
  );

  server.tool(
    "file_write",
    "Write content to a file. Creates the file if it does not exist.",
    {
      path: z.string().describe(
        "Workspace-relative path or absolute path inside /home/sandbox/workspace",
      ),
      content: z.string().describe("Content to write"),
      encoding: z.enum(["utf-8", "base64"]).optional().describe(
        "Input encoding (default: utf-8)",
      ),
      create_dirs: z.boolean().optional().describe(
        "Create parent directories if missing (default: false)",
      ),
    },
    (args: FileWriteOptions) => callTool("file_write", args),
  );

  server.tool(
    "file_list",
    "List directory contents. Returns name, type, size, and modification time.",
    {
      path: z.string().describe(
        "Workspace-relative directory path or absolute path inside /home/sandbox/workspace",
      ),
      recursive: z.boolean().optional().describe(
        "Recurse into subdirectories (default: false)",
      ),
      glob: z.string().optional().describe(
        'Filter entries by glob pattern (e.g. "*.ts")',
      ),
    },
    (args: FileListOptions) => callTool("file_list", args),
  );

  server.tool(
    "file_info",
    "Get file or directory metadata: existence, type, size, modification time, permissions.",
    {
      path: z.string().describe(
        "Workspace-relative path or absolute path inside /home/sandbox/workspace",
      ),
    },
    (args: { path: string }) => callTool("file_info", args),
  );

  // ---------------------------------------------------------------------------
  // Process tools
  // ---------------------------------------------------------------------------

  server.tool(
    "process_list",
    "List running processes (via ps aux).",
    {},
    () => callTool("process_list", {}),
  );

  server.tool(
    "process_kill",
    "Kill a process by PID if ShellManager is tracking it. Sends SIGTERM by default.",
    {
      pid: z.number().describe("Process ID to kill"),
      signal: z.string().optional().describe("Signal name (default: SIGTERM)"),
    },
    (args: { pid: number; signal?: string }) => callTool("process_kill", args),
  );

  return server;
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

/**
 * Create a request handler for the MCP server that works with Hono.
 * Handles the JSON-RPC subset used by MCP Streamable HTTP clients.
 */
export function createMcpRequestHandler(
  deps: McpServerDeps,
  authToken?: string,
  options: { allowUnauthenticated?: boolean } = {},
): McpRequestHandler {
  const tools = createSandboxToolDefinitions(deps);
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { Allow: "POST, OPTIONS" },
      });
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          error:
            "MCP Streamable HTTP requests must use POST; server-to-client GET streams are not supported by this sandbox endpoint",
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

    if (!authToken && !options.allowUnauthenticated) {
      return new Response(
        JSON.stringify({ error: "MCP auth not configured" }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (authToken) {
      const header = request.headers.get("Authorization");
      const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token || !constantTimeEqual(token, authToken)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    let body: unknown;
    try {
      body = await request.json();
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
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "takos-computer-sandbox",
          version: "1.0.0",
        },
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
      return jsonRpcResponse(
        id,
        await tool.handle(args, {
          signal: request.signal,
        }),
      );
    } catch (err) {
      return jsonRpcError(
        id,
        -32603,
        err instanceof Error ? err.message : String(err),
      );
    }
  };
}
