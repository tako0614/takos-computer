import { assertEquals } from "@std/assert";
import {
  createLocalDevSandboxHost,
  LOCAL_DEV_DEFAULTS,
} from "../local-dev-simulator.ts";

const HOST_AUTH_TOKEN = "test-host-token";
const PUBLISHED_MCP_AUTH_TOKEN = "test-published-mcp-token";
const MCP_AUTH_TOKEN = "test-mcp-token";

Deno.test("local dev simulator exposes a ready sandbox host env", async () => {
  const workspaceRoot = await Deno.makeTempDir({
    prefix: "takos-computer-local-",
  });
  try {
    const host = createLocalDevSandboxHost({
      workspaceRoot,
      hostAuthToken: HOST_AUTH_TOKEN,
      publishedMcpAuthToken: PUBLISHED_MCP_AUTH_TOKEN,
      mcpAuthToken: MCP_AUTH_TOKEN,
    });

    const response = await host.fetch(new Request("http://local/readyz"));

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      status: "ok",
      service: "takos-sandbox-host",
      missingBindings: [],
    });
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("local dev simulator creates sessions and proxies MCP to sandbox service", async () => {
  const workspaceRoot = await Deno.makeTempDir({
    prefix: "takos-computer-local-",
  });
  try {
    const host = createLocalDevSandboxHost({
      workspaceRoot,
      hostAuthToken: HOST_AUTH_TOKEN,
      publishedMcpAuthToken: PUBLISHED_MCP_AUTH_TOKEN,
      mcpAuthToken: MCP_AUTH_TOKEN,
    });

    const createResponse = await host.fetch(
      new Request("http://local/gui/api/sandbox-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${HOST_AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          sessionId: "session-1",
          spaceId: "space-1",
          userId: "user-1",
        }),
      }),
    );
    assertEquals(createResponse.status, 201);
    const createBody = await createResponse.json() as { proxyToken: string };

    const writeResult = await callSessionMcp(
      host.fetch,
      createBody.proxyToken,
      "file_write",
      { path: "hello.txt", content: "hello local", create_dirs: true },
    );
    assertEquals(writeResult.bytes_written, "hello local".length);

    const readResult = await callSessionMcp(
      host.fetch,
      createBody.proxyToken,
      "file_read",
      { path: "hello.txt" },
    );
    assertEquals(readResult.content, "hello local");

    const indexedState = await host.sessionIndex.get("session:session-1", {
      type: "json",
    }) as {
      sessionId: string;
      spaceId: string;
      userId: string;
      status: string;
      createdAt: string;
    };
    assertEquals(indexedState, {
      sessionId: "session-1",
      spaceId: "space-1",
      userId: "user-1",
      status: "active",
      createdAt: indexedState.createdAt,
    });
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

Deno.test("local dev simulator published MCP auto-creates a local session", async () => {
  const workspaceRoot = await Deno.makeTempDir({
    prefix: "takos-computer-local-",
  });
  try {
    const host = createLocalDevSandboxHost({ workspaceRoot });

    const response = await host.fetch(
      new Request("http://local/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOCAL_DEV_DEFAULTS.publishedMcpAuthToken}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "computer_file_write",
            arguments: {
              session_id: "published-session",
              space_id: "space-1",
              user_id: "user-1",
              path: "published.txt",
              content: "published local",
            },
          },
        }),
      }),
    );

    assertEquals(response.status, 200);
    const body = await response.json() as {
      result: { content: Array<{ text: string }> };
    };
    const result = JSON.parse(body.result.content[0].text) as {
      bytes_written: number;
    };
    assertEquals(result.bytes_written, "published local".length);

    const state = await host.sessionIndex.get("session:published-session", {
      type: "json",
    }) as { status: string };
    assertEquals(state.status, "active");
  } finally {
    await Deno.remove(workspaceRoot, { recursive: true });
  }
});

async function callSessionMcp(
  fetch: (request: Request) => Promise<Response>,
  proxyToken: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    new Request("http://local/gui/api/sandbox-session/session-1/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Proxy-Token": proxyToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  assertEquals(response.status, 200);
  const body = await response.json() as {
    result: { content: Array<{ text: string }> };
  };
  return JSON.parse(body.result.content[0].text) as Record<string, unknown>;
}
