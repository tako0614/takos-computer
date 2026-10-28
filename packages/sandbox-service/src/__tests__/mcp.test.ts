import { expect, test } from "bun:test";

import { FsManager } from "../fs-manager.ts";
import { createMcpRequestHandler } from "../mcp.ts";
import { ShellManager } from "../shell-manager.ts";

const MCP_AUTH_TOKEN = "test-mcp-token";

function createRequest(body: unknown, token = MCP_AUTH_TOKEN): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

test("MCP process_kill rejects signal injection before execution", async () => {
  const handler = createMcpRequestHandler(
    { shell: new ShellManager("/tmp"), fs: new FsManager() },
    MCP_AUTH_TOKEN,
  );

  const res = await handler(createRequest({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "process_kill",
      arguments: {
        pid: 12345,
        signal: "SIGTERM; touch /tmp/pwned",
      },
    },
    id: 1,
  }));

  expect(res.status).toEqual(200);
  const body = await res.json() as {
    error?: { code: number; message: string };
  };
  expect(body.error?.code).toEqual(-32603);
  expect(body.error?.message.includes("Unsupported signal")).toBeTruthy();
});

test("MCP process_kill rejects unmanaged pids", async () => {
  const handler = createMcpRequestHandler(
    { shell: new ShellManager("/tmp"), fs: new FsManager() },
    MCP_AUTH_TOKEN,
  );
  const proc = Bun.spawn(["bash", "-c", "sleep 30"], {
    stdout: "ignore",
    stderr: "ignore",
  });

  try {
    const res = await handler(createRequest({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "process_kill",
        arguments: {
          pid: proc.pid,
        },
      },
      id: 2,
    }));

    expect(res.status).toEqual(200);
    const body = await res.json() as {
      result?: { content: Array<{ type: "text"; text: string }> };
    };
    const payload = JSON.parse(body.result?.content[0]?.text ?? "{}") as {
      killed?: boolean;
      error?: string;
      pid?: number;
    };
    expect(payload.pid).toEqual(proc.pid);
    expect(payload.killed).toEqual(false);
    expect(payload.error?.includes("not managed")).toBeTruthy();
  } finally {
    try {
      proc.kill("SIGKILL");
    } catch {
      // Process may already be gone.
    }
    await proc.exited;
  }
});

test("MCP file_list returns path jail failures as tool errors", async () => {
  const handler = createMcpRequestHandler(
    { shell: new ShellManager(process.cwd()), fs: new FsManager(process.cwd()) },
    MCP_AUTH_TOKEN,
  );

  const res = await handler(createRequest({
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: "file_list", arguments: { path: "../outside" } },
    id: 3,
  }));

  expect(res.status).toEqual(200);
  const body = await res.json() as {
    result?: { isError?: boolean; content: Array<{ type: "text"; text: string }> };
    error?: unknown;
  };
  expect(body.error).toBeUndefined();
  expect(body.result?.isError).toBe(true);
  expect(body.result?.content[0]?.text).toContain("outside workspace");
});

test("MCP shell nonzero exit remains a successful tool result", async () => {
  const handler = createMcpRequestHandler(
    { shell: new ShellManager(process.cwd()), fs: new FsManager(process.cwd()) },
    MCP_AUTH_TOKEN,
  );

  const res = await handler(createRequest({
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: "shell_exec", arguments: { command: "exit 7" } },
    id: 4,
  }));

  const body = await res.json() as {
    result?: { isError?: boolean; content: Array<{ type: "text"; text: string }> };
  };
  const result = JSON.parse(body.result?.content[0]?.text ?? "{}") as {
    exit_code?: number;
  };
  expect(body.result?.isError).toBeUndefined();
  expect(result.exit_code).toEqual(7);
});
