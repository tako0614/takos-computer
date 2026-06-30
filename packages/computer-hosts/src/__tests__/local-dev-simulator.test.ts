import { expect, test } from "bun:test";

import {
  createLocalDevSandboxHost,
  LOCAL_DEV_DEFAULTS,
} from "../local-dev-simulator.ts";
import { makeTempDir, remove } from "./fs-helpers.ts";

const HOST_AUTH_TOKEN = "test-host-token";
const PUBLISHED_MCP_AUTH_TOKEN = "test-published-mcp-token";
const MCP_AUTH_TOKEN = "test-mcp-token";

test("local dev simulator exposes a ready sandbox host env", async () => {
  const workspaceRoot = await makeTempDir({
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

    expect(response.status).toEqual(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "takos-sandbox-host",
      missingBindings: [],
    });
  } finally {
    await remove(workspaceRoot, { recursive: true });
  }
});

test("local dev simulator creates sessions and proxies MCP to sandbox service", async () => {
  const workspaceRoot = await makeTempDir({
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
    expect(createResponse.status).toEqual(201);
    const createBody = await createResponse.json() as { proxyToken: string };

    const writeResult = await callSessionMcp(
      host.fetch,
      createBody.proxyToken,
      "file_write",
      { path: "hello.txt", content: "hello local", create_dirs: true },
    );
    expect(writeResult.bytes_written).toEqual("hello local".length);

    const readResult = await callSessionMcp(
      host.fetch,
      createBody.proxyToken,
      "file_read",
      { path: "hello.txt" },
    );
    expect(readResult.content).toEqual("hello local");

    // The index keys by owner so a GUI caller lists only its own sessions:
    // `session:<encodeURIComponent(userId)>:<sessionId>`.
    const indexedState = await host.sessionIndex.get(
      "session:user-1:session-1",
      { type: "json" },
    ) as {
      sessionId: string;
      spaceId: string;
      userId: string;
      status: string;
      createdAt: string;
    };
    expect(indexedState).toEqual({
      sessionId: "session-1",
      spaceId: "space-1",
      userId: "user-1",
      status: "active",
      createdAt: indexedState.createdAt,
    });
  } finally {
    await remove(workspaceRoot, { recursive: true });
  }
});

test("local dev simulator published MCP auto-creates a local session", async () => {
  const workspaceRoot = await makeTempDir({
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

    expect(response.status).toEqual(200);
    const body = await response.json() as {
      result: { content: Array<{ text: string }> };
    };
    const result = JSON.parse(body.result.content[0].text) as {
      bytes_written: number;
    };
    expect(result.bytes_written).toEqual("published local".length);

    // The published session is indexed under an owner + token-scoped key
    // (`session:<owner>:pmcp-<hash>:published-session`), never the raw logical
    // id, so sessions with the same logical id under different tokens cannot
    // collide.
    const indexed = await host.sessionIndex.list({ prefix: "session:" });
    const scopedKey = indexed.keys
      .map((k) => k.name)
      .find((name) =>
        name.includes(":pmcp-") && name.endsWith(":published-session")
      );
    if (!scopedKey) {
      throw new Error(
        `Expected a token-scoped published session index entry, got: ${
          indexed.keys.map((k) => k.name).join(", ")
        }`,
      );
    }
    // The raw logical id must NOT be a standalone index key — the admin GUI
    // would otherwise try (and fail) to address the DO by it.
    if (
      indexed.keys.some((k) =>
        k.name === "session:published-session" ||
        k.name === "session:user-1:published-session"
      )
    ) {
      throw new Error(
        "Published session must not be indexed under the raw logical id",
      );
    }
    const state = await host.sessionIndex.get(scopedKey, {
      type: "json",
    }) as { status: string; sessionId: string };
    expect(state.status).toEqual("active");
    // The stored addressing id (the scoped DO name) is the index key suffix so
    // the admin GUI list -> get/destroy round-trips hit the same DO/KV entry.
    expect(state.sessionId.startsWith("pmcp-")).toBeTruthy();
    expect(scopedKey.endsWith(`:${state.sessionId}`)).toBeTruthy();
  } finally {
    await remove(workspaceRoot, { recursive: true });
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
  expect(response.status).toEqual(200);
  const body = await response.json() as {
    result: { content: Array<{ text: string }> };
  };
  return JSON.parse(body.result.content[0].text) as Record<string, unknown>;
}
