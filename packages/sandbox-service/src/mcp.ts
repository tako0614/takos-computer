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

import { constantTimeEqual } from "@takos-computer/common/crypto";
import {
  createMcpEnvelope,
  isRecord,
  type McpToolResult,
  mcpJson,
  mcpText,
} from "@takos-computer/common/mcp-rpc";
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

type ToolContext = {
  signal: AbortSignal;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handle: (args: unknown, context: ToolContext) => Promise<McpToolResult>;
};

export type McpRequestHandler = (request: Request) => Promise<Response>;

function errorText(err: unknown): McpToolResult {
  return mcpText(`Error: ${err instanceof Error ? err.message : String(err)}`);
}

function objectArgs(args: unknown): Record<string, unknown> {
  return isRecord(args) ? args : {};
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
        } as ShellExecOptions).then(mcpJson),
    },
    {
      name: "file_read",
      description:
        "Read file contents. Returns content, size, and truncation status.",
      inputSchema: { type: "object" },
      handle: async (args, context) => {
        try {
          return mcpJson(
            await fs.read(args as FileReadOptions, context.signal),
          );
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
          return mcpJson(await fs.write(args as FileWriteOptions));
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
      handle: async (args, context) => {
        try {
          return mcpJson({
            entries: await fs.list(args as FileListOptions, context.signal),
          });
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
          return mcpJson(await fs.info(args.path));
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
        if (result.exit_code !== 0) {
          return mcpText(`Error: ${result.stderr}`);
        }

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
        return mcpJson({ processes });
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
        return Promise.resolve(mcpJson(
          shell.killProcess(args.pid, signal as ProcessSignal),
        ));
      },
    },
  ];
}

/**
 * Auth gate for the sandbox MCP endpoint: 503 when no token is configured and
 * unauthenticated access is not explicitly allowed, 401 on a missing/mismatched
 * bearer token. Returns `null` to allow the request through.
 */
function authorizeSandboxMcp(
  request: Request,
  authToken: string | undefined,
  allowUnauthenticated: boolean,
): Response | null {
  if (!authToken && !allowUnauthenticated) {
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

  return null;
}

/**
 * Create a request handler for the MCP server that works with Hono.
 * Handles the JSON-RPC subset used by MCP Streamable HTTP clients via the
 * shared `createMcpEnvelope`; only the tool set, identity, and auth gate are
 * sandbox-specific.
 */
export function createMcpRequestHandler(
  deps: McpServerDeps,
  authToken?: string,
  options: { allowUnauthenticated?: boolean } = {},
): McpRequestHandler {
  const tools = createSandboxToolDefinitions(deps);
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  return createMcpEnvelope<ToolContext>({
    serverInfo: { name: "takos-computer-sandbox", version: "1.0.0" },
    tools,
    toolMap,
    endpointLabel: "sandbox endpoint",
    authorize: (request) =>
      authorizeSandboxMcp(
        request,
        authToken,
        options.allowUnauthenticated ?? false,
      ),
    callContext: (request) => ({ signal: request.signal }),
  });
}
