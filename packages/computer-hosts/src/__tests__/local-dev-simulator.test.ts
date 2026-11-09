import { expect, test } from "bun:test";

import {
  createLocalDevSandboxHost,
  LOCAL_DEV_HOST,
  LOCAL_DEV_DEFAULTS,
  sessionWorkspaceSegment,
} from "../local-dev-simulator.ts";
import { makeTempDir, remove } from "./fs-helpers.ts";

const HOST_AUTH_TOKEN = "test-host-token";
const PUBLISHED_MCP_AUTH_TOKEN = "test-published-mcp-token";
const MCP_AUTH_TOKEN = "test-mcp-token";

test("local dev simulator is loopback-only and maps ids injectively", () => {
  expect(LOCAL_DEV_HOST).toEqual("127.0.0.1");
  expect(sessionWorkspaceSegment("a/b")).not.toEqual(
    sessionWorkspaceSegment("a?b"),
  );
  expect(sessionWorkspaceSegment("日本語")).toEqual(
    sessionWorkspaceSegment("日本語"),
  );
  expect(() => sessionWorkspaceSegment("x".repeat(181))).toThrow(
    "workspace session name must be 1..180 UTF-8 bytes",
  );
});

test("local dev simulator preserves a stopped session for its original owner's recovery", async () => {
  const workspaceRoot = await makeTempDir({ prefix: "computer-owner-recovery-" });
  try {
    const host = createLocalDevSandboxHost({ workspaceRoot, hostAuthToken: HOST_AUTH_TOKEN });
    const sessionId = "retained-owner";
    const create = (userId: string) => host.fetch(new Request("http://local/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${HOST_AUTH_TOKEN}` },
      body: JSON.stringify({ sessionId, spaceId: "space-1", userId }),
    }));
    const first = await create("user-a");
    expect(first.status).toBe(201);
    const originalToken = (await first.json() as { proxyToken: string }).proxyToken;
    expect((await host.fetch(new Request("http://local/session/" + sessionId, {
      method: "DELETE", headers: { Authorization: `Bearer ${HOST_AUTH_TOKEN}` },
    }))).status).toBe(200);
    const session = host.sandboxContainer.get(host.sandboxContainer.idFromName(sessionId));
    const stopped = await session.getSessionState();
    expect(stopped?.status).toBe("stopped");

    expect((await create("user-b")).status).toBe(409);
    expect(await session.getSessionState()).toEqual(stopped);
    const restored = await create("user-a");
    expect(restored.status).toBe(201);
    const restoredToken = (await restored.json() as { proxyToken: string }).proxyToken;
    expect(restoredToken).not.toEqual(originalToken);
    expect(await session.verifyProxyToken(originalToken)).toBeNull();
    expect(await session.getSessionState()).toMatchObject({ userId: "user-a", spaceId: "space-1", status: "active" });
  } finally {
    await remove(workspaceRoot, { recursive: true });
  }
});

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

test("local dev simulator live reconnect preserves the original connection and state", async () => {
  const workspaceRoot = await makeTempDir({ prefix: "computer-live-reconnect-" });
  try {
    const host = createLocalDevSandboxHost({ workspaceRoot, hostAuthToken: HOST_AUTH_TOKEN });
    const create = () => host.fetch(new Request("http://local/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${HOST_AUTH_TOKEN}` },
      body: JSON.stringify({ sessionId: "session-1", spaceId: "space-1", userId: "user-1" }),
    }));
    const initial = await create();
    expect(initial.status).toBe(201);
    const { proxyToken } = await initial.json() as { proxyToken: string };
    await callSessionMcp(host.fetch, proxyToken, "file_write", {
      path: "retained.txt", content: "retained content",
    });
    const session = host.sandboxContainer.get(host.sandboxContainer.idFromName("session-1"));
    const before = await session.getSessionState();

    const reconnected = await create();
    expect(reconnected.status).toBe(201);
    expect(await reconnected.json()).toMatchObject({ proxyToken, reused: true });
    expect(await session.getSessionState()).toEqual(before);
    expect(await session.verifyProxyToken(proxyToken)).toMatchObject({ userId: "user-1", spaceId: "space-1" });
    const read = await callSessionMcp(host.fetch, proxyToken, "file_read", { path: "retained.txt" });
    expect(read.content).toBe("retained content");
  } finally {
    await remove(workspaceRoot, { recursive: true });
  }
});

test("local dev simulator live reconnect keeps the running command under its original manager", async () => {
  const workspaceRoot = await makeTempDir({ prefix: "computer-live-manager-" });
  let running: Promise<Record<string, unknown>> | undefined;
  try {
    const host = createLocalDevSandboxHost({ workspaceRoot, hostAuthToken: HOST_AUTH_TOKEN });
    const create = () => host.fetch(new Request("http://local/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${HOST_AUTH_TOKEN}` },
      body: JSON.stringify({ sessionId: "session-1", spaceId: "space-1", userId: "user-1" }),
    }));
    const initial = await create();
    expect(initial.status).toBe(201);
    const { proxyToken } = await initial.json() as { proxyToken: string };
    running = callSessionMcp(host.fetch, proxyToken, "shell_exec", {
      command: 'printf "%s" "$$" > managed.pid; sleep 2', timeout_ms: 4_000,
    });
    const pidPath = `${workspaceRoot}/${sessionWorkspaceSegment("session-1")}/managed.pid`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await Bun.file(pidPath).exists()) { ready = true; break; }
      await Bun.sleep(5);
    }
    expect(ready).toBe(true);
    const pid = Number(await Bun.file(pidPath).text());
    expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);

    const reconnected = await create();
    expect(reconnected.status).toBe(201);
    const current = await reconnected.json() as { proxyToken: string };
    const killed = await callSessionMcp(host.fetch, current.proxyToken, "process_kill", { pid });
    expect(killed).toMatchObject({ killed: true, pid, signal: "SIGTERM" });
    expect(await running).toMatchObject({ exit_code: 143, timed_out: false });
  } finally {
    // The fixture owns this finite command; let it finish even on the RED path.
    await running?.catch(() => {});
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
