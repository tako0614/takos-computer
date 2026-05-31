import { expect, test } from "bun:test";

import { createSandboxServiceApp } from "../app.ts";

const MCP_AUTH_TOKEN = "test-mcp-token";

test("createSandboxServiceApp: creates app successfully", () => {
  const { app, shell, fs, logger } = createSandboxServiceApp({
    serviceName: "test-sandbox",
    mcpAuthToken: MCP_AUTH_TOKEN,
  });
  expect(app !== undefined).toBeTruthy();
  expect(shell !== undefined).toBeTruthy();
  expect(fs !== undefined).toBeTruthy();
  expect(logger !== undefined).toBeTruthy();
});

test("createSandboxServiceApp: health endpoint returns 200", async () => {
  const { app } = createSandboxServiceApp({ serviceName: "test-sandbox" });

  const req = new Request("http://localhost/healthz");
  const res = await app.fetch(req);
  expect(res.status).toEqual(200);

  const body = await res.json() as { service: string; status: string };
  expect(body.status).toEqual("ok");
  expect(body.service).toEqual("test-sandbox");
});

test("createSandboxServiceApp: MCP endpoint handles tools/call", async () => {
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
  expect(res.status).toEqual(200);
  const body = await res.json() as {
    result: { content: Array<{ type: string; text: string }> };
  };
  const result = JSON.parse(body.result.content[0].text) as {
    stdout: string;
    exit_code: number;
  };
  expect(result.stdout).toEqual("sandbox-ok");
  expect(result.exit_code).toEqual(0);
});

test("createSandboxServiceApp: MCP endpoint requires configured auth", async () => {
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
  expect(res.status).toEqual(503);
});

test("createSandboxServiceApp: MCP endpoint rejects missing bearer token", async () => {
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
  expect(res.status).toEqual(401);
});

test("createSandboxServiceApp: MCP endpoint rejects GET streams explicitly", async () => {
  const { app } = createSandboxServiceApp({
    serviceName: "test-sandbox",
    mcpAuthToken: MCP_AUTH_TOKEN,
  });

  const req = new Request("http://localhost/mcp", {
    method: "GET",
    headers: { Authorization: `Bearer ${MCP_AUTH_TOKEN}` },
  });

  const res = await app.fetch(req);
  expect(res.status).toEqual(405);
  expect(res.headers.get("allow")).toEqual("POST, OPTIONS");
  expect(await res.json()).toEqual({
    error:
      "MCP Streamable HTTP requests must use POST; server-to-client GET streams are not supported by this sandbox endpoint",
  });
});

test("createSandboxServiceApp: default service name is 'sandbox'", async () => {
  const { app } = createSandboxServiceApp();

  const req = new Request("http://localhost/healthz");
  const res = await app.fetch(req);
  const body = await res.json() as { service: string };
  expect(body.service).toEqual("sandbox");
});
