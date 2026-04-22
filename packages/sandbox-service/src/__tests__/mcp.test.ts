import { assert, assertEquals } from "@std/assert";
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

Deno.test("MCP process_kill rejects signal injection before execution", async () => {
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

  assertEquals(res.status, 200);
  const body = await res.json() as {
    error?: { code: number; message: string };
  };
  assertEquals(body.error?.code, -32603);
  assert(body.error?.message.includes("Unsupported signal"));
});
