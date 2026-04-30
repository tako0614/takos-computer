import { assert, assertEquals } from "@std/assert";
import { createSandboxServiceApp } from "../app.ts";

const MCP_AUTH_TOKEN = "test-mcp-token";

Deno.test("createSandboxServiceApp: creates app successfully", () => {
  const { app, shell, fs, logger } = createSandboxServiceApp({
    serviceName: "test-sandbox",
    mcpAuthToken: MCP_AUTH_TOKEN,
  });
  assert(app !== undefined);
  assert(shell !== undefined);
  assert(fs !== undefined);
  assert(logger !== undefined);
});

Deno.test("createSandboxServiceApp: health endpoint returns 200", async () => {
  const { app } = createSandboxServiceApp({ serviceName: "test-sandbox" });

  const req = new Request("http://localhost/healthz");
  const res = await app.fetch(req);
  assertEquals(res.status, 200);

  const body = await res.json() as { service: string; status: string };
  assertEquals(body.status, "ok");
  assertEquals(body.service, "test-sandbox");
});

Deno.test("createSandboxServiceApp: MCP endpoint handles tools/call", async () => {
  const { app } = createSandboxServiceApp({
    serviceName: "test-sandbox",
    workspaceRoot: Deno.cwd(),
    mcpAuthToken: MCP_AUTH_TOKEN,
  });

  const req = new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MCP_AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "shell_exec",
        arguments: { command: "printf sandbox-ok", cwd: Deno.cwd() },
      },
      id: 1,
    }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 200);
  const body = await res.json() as {
    result: { content: Array<{ type: string; text: string }> };
  };
  const result = JSON.parse(body.result.content[0].text) as {
    stdout: string;
    exit_code: number;
  };
  assertEquals(result.stdout, "sandbox-ok");
  assertEquals(result.exit_code, 0);
});

Deno.test("createSandboxServiceApp: MCP endpoint requires configured auth", async () => {
  const { app } = createSandboxServiceApp({
    serviceName: "test-sandbox",
    mcpAuthToken: null,
  });

  const req = new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/list",
      id: 1,
    }),
  });

  const res = await app.fetch(req);
  assertEquals(res.status, 503);
});

Deno.test("createSandboxServiceApp: MCP endpoint rejects missing bearer token", async () => {
  const { app } = createSandboxServiceApp({
    serviceName: "test-sandbox",
    mcpAuthToken: MCP_AUTH_TOKEN,
  });

  const req = new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/list",
      id: 1,
    }),
  });

  const res = await app.fetch(req);
  assertEquals(res.status, 401);
});

Deno.test("createSandboxServiceApp: default service name is 'sandbox'", async () => {
  const { app } = createSandboxServiceApp();

  const req = new Request("http://localhost/healthz");
  const res = await app.fetch(req);
  const body = await res.json() as { service: string };
  assertEquals(body.service, "sandbox");
});
