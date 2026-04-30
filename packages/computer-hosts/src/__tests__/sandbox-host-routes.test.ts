import worker from "../sandbox-host.ts";
import type {
  CreateSandboxSessionPayload,
  SandboxHostEnv,
  SandboxSessionState,
  SandboxSessionTokenInfo,
} from "../sandbox-session-types.ts";

type WorkerFetch = (
  request: Request,
  env: SandboxHostEnv,
) => Promise<Response>;

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

class MemoryKv implements NonNullable<SandboxHostEnv["SESSION_INDEX"]> {
  private values = new Map<string, string>();

  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get(key: string, options: { type: "json" }): Promise<unknown>;
  get(
    key: string,
    options?: { type?: "text" | "json" },
  ): Promise<string | null | unknown> {
    const value = this.values.get(key) ?? null;
    if (options?.type === "json") {
      return Promise.resolve(value ? JSON.parse(value) : null);
    }
    return Promise.resolve(value);
  }

  put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  list(options?: { prefix?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const keys = [...this.values.keys()]
      .filter((name) => !options?.prefix || name.startsWith(options.prefix))
      .map((name) => ({ name }));
    return Promise.resolve({ keys, list_complete: true });
  }
}

const HOST_AUTH_TOKEN = "host-token";
const PUBLISHED_MCP_AUTH_TOKEN = "published-mcp-token";
const MCP_AUTH_TOKEN = "mcp-token";
const SESSION_PROXY_TOKEN = "test-token";

function hostAuthHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${HOST_AUTH_TOKEN}` };
}

function createEnv(
  options: {
    hostAuthToken?: string | null;
    publishedMcpAuthToken?: string | null;
    mcpAuthToken?: string | null;
    trustRoutedGuiApi?: boolean;
  } = {},
) {
  const states = new Map<string, SandboxSessionState>();
  const mcpCalls: Array<{
    path: string;
    authorization: string | null;
    body: unknown;
  }> = [];

  const stub = {
    createSession(
      payload: CreateSandboxSessionPayload,
    ): Promise<{ ok: true; proxyToken: string }> {
      states.set(payload.sessionId, {
        ...payload,
        status: "active",
        createdAt: "2026-04-20T00:00:00.000Z",
      });
      return Promise.resolve({ ok: true, proxyToken: SESSION_PROXY_TOKEN });
    },
    verifyProxyToken(token: string): Promise<SandboxSessionTokenInfo | null> {
      if (token !== SESSION_PROXY_TOKEN) return Promise.resolve(null);
      return Promise.resolve({
        sessionId: currentSessionId,
        spaceId: "space-1",
        userId: "user-1",
      });
    },
    getSessionState(): SandboxSessionState | null {
      return states.get(currentSessionId) ?? null;
    },
    destroySession(): Promise<void> {
      states.delete(currentSessionId);
      return Promise.resolve();
    },
    forwardToContainer(
      path: string,
      init?: RequestInit,
    ): Promise<Response> {
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body)
        : null;
      mcpCalls.push({
        path,
        authorization: headers.get("Authorization"),
        body,
      });
      if (body?.method === "tools/call") {
        return Promise.resolve(Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{
              type: "text",
              text: JSON.stringify({
                tool: body.params?.name,
                arguments: body.params?.arguments,
              }),
            }],
          },
        }));
      }
      return Promise.resolve(Response.json({ ok: true, path, body }));
    },
  };

  let currentSessionId = "";
  const env = {
    SANDBOX_CONTAINER: {
      idFromName(name: string) {
        currentSessionId = name;
        return name;
      },
      get() {
        return stub;
      },
    },
    SESSION_INDEX: new MemoryKv(),
  } as unknown as SandboxHostEnv;
  const hostAuthToken = options.hostAuthToken === undefined
    ? HOST_AUTH_TOKEN
    : options.hostAuthToken;
  if (hostAuthToken !== null) env.SANDBOX_HOST_AUTH_TOKEN = hostAuthToken;
  const publishedMcpAuthToken = options.publishedMcpAuthToken;
  if (publishedMcpAuthToken === undefined) {
    env.PUBLISHED_MCP_AUTH_TOKEN = PUBLISHED_MCP_AUTH_TOKEN;
  } else if (publishedMcpAuthToken) {
    env.PUBLISHED_MCP_AUTH_TOKEN = publishedMcpAuthToken;
  }
  const mcpAuthToken = options.mcpAuthToken === undefined
    ? MCP_AUTH_TOKEN
    : options.mcpAuthToken;
  if (mcpAuthToken !== null) env.MCP_AUTH_TOKEN = mcpAuthToken;
  if (options.trustRoutedGuiApi) env.TAKOS_TRUST_ROUTED_GUI_API = "1";

  return { env, mcpCalls };
}

function fetchWorker(
  env: SandboxHostEnv,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return (worker.fetch as WorkerFetch)(
    new Request(`https://sandbox-host.test${path}`, init),
    env,
  );
}

function publishedMcpAuthHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${PUBLISHED_MCP_AUTH_TOKEN}` };
}

Deno.test("sandbox host serves published GUI app routes", async () => {
  const { env } = createEnv();

  const unauthenticatedResponse = await fetchWorker(env, "/gui");
  assertEquals(unauthenticatedResponse.status, 401);

  const authResponse = await fetchWorker(
    env,
    `/gui?authToken=${encodeURIComponent(HOST_AUTH_TOKEN)}`,
  );
  assertEquals(authResponse.status, 302);
  assertEquals(authResponse.headers.get("location"), "/gui");
  const cookie = authResponse.headers.get("set-cookie");
  if (!cookie?.includes("takos_computer_admin_token=")) {
    throw new Error("Expected GUI admin auth cookie");
  }

  const indexResponse = await fetchWorker(env, "/gui", {
    headers: { Cookie: cookie },
  });
  assertEquals(indexResponse.status, 200);
  assertEquals(
    indexResponse.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  const html = await indexResponse.text();
  if (!html.includes('<div id="app"></div>')) {
    throw new Error("Expected GUI HTML shell");
  }

  const fallbackResponse = await fetchWorker(env, "/gui/sessions/session-1", {
    headers: { Cookie: cookie },
  });
  assertEquals(fallbackResponse.status, 200);
  assertEquals(
    fallbackResponse.headers.get("content-type"),
    "text/html; charset=utf-8",
  );

  const styleResponse = await fetchWorker(env, "/gui/style.css");
  assertEquals(styleResponse.status, 200);
  assertEquals(
    styleResponse.headers.get("content-type"),
    "text/css; charset=utf-8",
  );

  const iconResponse = await fetchWorker(env, "/icons/computer.svg");
  assertEquals(iconResponse.status, 200);
  assertEquals(iconResponse.headers.get("content-type"), "image/svg+xml");
  const iconBody = await iconResponse.text();
  if (!iconBody.includes('aria-label="Computer"')) {
    throw new Error("Expected computer icon SVG");
  }
});

Deno.test("sandbox host rejects routed marker header without GUI auth", async () => {
  const { env } = createEnv();
  const response = await fetchWorker(env, "/gui", {
    headers: { "X-Takos-Internal-Marker": "1" },
  });

  assertEquals(response.status, 401);
});

Deno.test("sandbox host accepts trusted Takos-routed GUI requests when enabled", async () => {
  const { env } = createEnv({ trustRoutedGuiApi: true });
  const response = await fetchWorker(env, "/gui", {
    headers: { "X-Takos-Internal-Marker": "1" },
  });

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
});

Deno.test("sandbox host health reports missing required bindings", async () => {
  const { env } = createEnv({
    hostAuthToken: null,
    mcpAuthToken: null,
    publishedMcpAuthToken: null,
  });
  delete env.SESSION_INDEX;

  const response = await fetchWorker(env, "/health");

  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    status: "misconfigured",
    service: "takos-sandbox-host",
    missingBindings: [
      "SANDBOX_HOST_AUTH_TOKEN",
      "MCP_AUTH_TOKEN",
      "PUBLISHED_MCP_AUTH_TOKEN",
      "SESSION_INDEX",
    ],
  });
});

Deno.test("sandbox host healthz is bootstrap-safe while readyz is strict", async () => {
  const { env } = createEnv({
    hostAuthToken: null,
    mcpAuthToken: null,
    publishedMcpAuthToken: null,
  });
  delete env.SESSION_INDEX;

  const healthzResponse = await fetchWorker(env, "/healthz");
  assertEquals(healthzResponse.status, 200);
  assertEquals(await healthzResponse.json(), {
    status: "ok",
    service: "takos-sandbox-host",
    ready: false,
    missingBindings: [
      "SANDBOX_HOST_AUTH_TOKEN",
      "MCP_AUTH_TOKEN",
      "PUBLISHED_MCP_AUTH_TOKEN",
      "SESSION_INDEX",
    ],
  });

  const readyzResponse = await fetchWorker(env, "/readyz");
  assertEquals(readyzResponse.status, 503);
});

Deno.test("sandbox host does not use host auth token as container MCP auth fallback", async () => {
  const { env } = createEnv({ mcpAuthToken: null });

  const response = await fetchWorker(env, "/health");

  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    status: "misconfigured",
    service: "takos-sandbox-host",
    missingBindings: ["MCP_AUTH_TOKEN"],
  });
});

Deno.test("sandbox host readyz fails when published MCP auth token is missing", async () => {
  const { env } = createEnv({ publishedMcpAuthToken: null });

  const response = await fetchWorker(env, "/readyz");

  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    status: "misconfigured",
    service: "takos-sandbox-host",
    missingBindings: ["PUBLISHED_MCP_AUTH_TOKEN"],
  });
});

Deno.test("sandbox host supports published GUI compatibility routes", async () => {
  const { env } = createEnv();

  const createResponse = await fetchWorker(env, "/gui/api/sandbox-create", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...hostAuthHeaders() },
    body: JSON.stringify({
      sessionId: "session-1",
      spaceId: "space-1",
      userId: "user-1",
    }),
  });
  assertEquals(createResponse.status, 201);
  assertEquals(await createResponse.json(), {
    ok: true,
    proxyToken: SESSION_PROXY_TOKEN,
  });

  const listResponse = await fetchWorker(env, "/gui/api/sandbox-sessions", {
    headers: hostAuthHeaders(),
  });
  assertEquals(listResponse.status, 200);
  const listBody = await listResponse.json() as { sessions: unknown[] };
  assertEquals(listBody.sessions.length, 1);

  const getResponse = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1",
    { headers: hostAuthHeaders() },
  );
  assertEquals(getResponse.status, 200);
  const getBody = await getResponse.json() as { sessionId: string };
  assertEquals(getBody.sessionId, "session-1");

  const deleteResponse = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1",
    { method: "DELETE", headers: hostAuthHeaders() },
  );
  assertEquals(deleteResponse.status, 200);
  assertEquals(await deleteResponse.json(), { ok: true });
});

Deno.test("sandbox host accepts GUI admin auth cookie for dashboard APIs", async () => {
  const { env } = createEnv();
  const cookie = `takos_computer_admin_token=${
    encodeURIComponent(HOST_AUTH_TOKEN)
  }`;

  const createResponse = await fetchWorker(env, "/gui/api/sandbox-create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      sessionId: "session-1",
      spaceId: "space-1",
      userId: "user-1",
    }),
  });
  assertEquals(createResponse.status, 201);

  const listResponse = await fetchWorker(env, "/gui/api/sandbox-sessions", {
    headers: { Cookie: cookie },
  });
  assertEquals(listResponse.status, 200);
  const listBody = await listResponse.json() as { sessions: unknown[] };
  assertEquals(listBody.sessions.length, 1);
});

Deno.test("sandbox host rejects unauthenticated session create", async () => {
  const { env } = createEnv();

  const response = await fetchWorker(env, "/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-1",
      spaceId: "space-1",
      userId: "user-1",
    }),
  });

  assertEquals(response.status, 401);
});

Deno.test("sandbox host rejects routed marker header without API auth", async () => {
  const { env, mcpCalls } = createEnv();
  const createResponse = await fetchWorker(env, "/gui/api/sandbox-create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Takos-Internal-Marker": "1",
    },
    body: JSON.stringify({
      sessionId: "session-1",
      spaceId: "space-1",
      userId: "user-1",
    }),
  });
  assertEquals(createResponse.status, 401);

  const mcpResponse = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Takos-Internal-Marker": "1",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "process_list" }),
    },
  );
  assertEquals(mcpResponse.status, 401);
  assertEquals(mcpCalls, []);
});

Deno.test("sandbox host accepts trusted Takos-routed dashboard API and MCP requests", async () => {
  const { env, mcpCalls } = createEnv({ trustRoutedGuiApi: true });
  const trustedHeaders = {
    "Content-Type": "application/json",
    "X-Takos-Internal-Marker": "1",
  };
  const createResponse = await fetchWorker(env, "/gui/api/sandbox-create", {
    method: "POST",
    headers: trustedHeaders,
    body: JSON.stringify({
      sessionId: "session-1",
      spaceId: "space-1",
      userId: "user-1",
    }),
  });
  assertEquals(createResponse.status, 201);

  const listResponse = await fetchWorker(env, "/gui/api/sandbox-sessions", {
    headers: { "X-Takos-Internal-Marker": "1" },
  });
  assertEquals(listResponse.status, 200);
  const listBody = await listResponse.json() as { sessions: unknown[] };
  assertEquals(listBody.sessions.length, 1);

  const sessionResponse = await fetchWorker(env, "/session/session-1", {
    headers: { "X-Takos-Internal-Marker": "1" },
  });
  assertEquals(sessionResponse.status, 200);
  const sessionBody = await sessionResponse.json() as { sessionId: string };
  assertEquals(sessionBody.sessionId, "session-1");

  const mcpResponse = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1/mcp",
    {
      method: "POST",
      headers: trustedHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "process_list" }),
    },
  );
  assertEquals(mcpResponse.status, 200);
  assertEquals(mcpCalls, [{
    path: "/mcp",
    authorization: `Bearer ${MCP_AUTH_TOKEN}`,
    body: { jsonrpc: "2.0", method: "process_list" },
  }]);

  const sessionMcpResponse = await fetchWorker(
    env,
    "/session/session-1/mcp",
    {
      method: "POST",
      headers: trustedHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "file_list" }),
    },
  );
  assertEquals(sessionMcpResponse.status, 200);
  assertEquals(mcpCalls, [
    {
      path: "/mcp",
      authorization: `Bearer ${MCP_AUTH_TOKEN}`,
      body: { jsonrpc: "2.0", method: "process_list" },
    },
    {
      path: "/mcp",
      authorization: `Bearer ${MCP_AUTH_TOKEN}`,
      body: { jsonrpc: "2.0", method: "file_list" },
    },
  ]);
});

Deno.test("sandbox host fails closed when host auth token is missing", async () => {
  const { env } = createEnv({ hostAuthToken: null });

  const response = await fetchWorker(env, "/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...hostAuthHeaders() },
    body: JSON.stringify({
      sessionId: "session-1",
      spaceId: "space-1",
      userId: "user-1",
    }),
  });

  assertEquals(response.status, 503);
});

Deno.test("sandbox host supports published GUI MCP compatibility route", async () => {
  const { env, mcpCalls } = createEnv();

  const response = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SESSION_PROXY_TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "process_list" }),
    },
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    ok: true,
    path: "/mcp",
    body: { jsonrpc: "2.0", method: "process_list" },
  });
  assertEquals(mcpCalls, [{
    path: "/mcp",
    authorization: `Bearer ${MCP_AUTH_TOKEN}`,
    body: { jsonrpc: "2.0", method: "process_list" },
  }]);
});

Deno.test("sandbox host accepts GUI session proxy cookie for MCP route", async () => {
  const { env, mcpCalls } = createEnv();

  const cookie = `takos_computer_proxy_token=${
    encodeURIComponent(SESSION_PROXY_TOKEN)
  }`;

  const response = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "process_list" }),
    },
  );

  assertEquals(response.status, 200);
  assertEquals(mcpCalls, [{
    path: "/mcp",
    authorization: `Bearer ${MCP_AUTH_TOKEN}`,
    body: { jsonrpc: "2.0", method: "process_list" },
  }]);
});

Deno.test("sandbox host rejects proxyToken query auth for GUI session bootstrap", async () => {
  const { env } = createEnv();

  const response = await fetchWorker(
    env,
    `/gui/sandbox/session-1?proxyToken=${
      encodeURIComponent(SESSION_PROXY_TOKEN)
    }`,
  );

  assertEquals(response.status, 401);
  assertEquals(response.headers.get("set-cookie"), null);
});

Deno.test("sandbox host rejects proxyToken query auth for MCP route", async () => {
  const { env, mcpCalls } = createEnv();

  const response = await fetchWorker(
    env,
    `/gui/api/sandbox-session/session-1/mcp?proxyToken=${
      encodeURIComponent(SESSION_PROXY_TOKEN)
    }`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "process_list" }),
    },
  );

  assertEquals(response.status, 401);
  assertEquals(mcpCalls, []);
});

Deno.test("sandbox host accepts explicit proxy token header for MCP route", async () => {
  const { env, mcpCalls } = createEnv();

  const response = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Proxy-Token": SESSION_PROXY_TOKEN,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "process_list" }),
    },
  );

  assertEquals(response.status, 200);
  assertEquals(mcpCalls, [{
    path: "/mcp",
    authorization: `Bearer ${MCP_AUTH_TOKEN}`,
    body: { jsonrpc: "2.0", method: "process_list" },
  }]);
});

Deno.test("sandbox host forwards non-POST MCP compatibility requests instead of 404", async () => {
  const { env, mcpCalls } = createEnv();

  const response = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1/mcp",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${SESSION_PROXY_TOKEN}`,
      },
    },
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    ok: true,
    path: "/mcp",
    body: null,
  });
  assertEquals(mcpCalls, [{
    path: "/mcp",
    authorization: `Bearer ${MCP_AUTH_TOKEN}`,
    body: null,
  }]);
});

Deno.test("sandbox host rejects MCP without a valid session proxy token", async () => {
  const { env, mcpCalls } = createEnv();

  const response = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1/mcp",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "process_list" }),
    },
  );

  assertEquals(response.status, 401);
  assertEquals(mcpCalls, []);
});

Deno.test("sandbox host fails closed when no container MCP auth token source is configured", async () => {
  const { env, mcpCalls } = createEnv({
    mcpAuthToken: null,
  });

  const response = await fetchWorker(
    env,
    "/session/session-1/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SESSION_PROXY_TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "process_list" }),
    },
  );

  assertEquals(response.status, 503);
  assertEquals(mcpCalls, []);
});

Deno.test("sandbox host published MCP lists computer tools with published auth", async () => {
  const { env } = createEnv();

  const response = await fetchWorker(env, "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...publishedMcpAuthHeaders(),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });

  assertEquals(response.status, 200);
  const body = await response.json() as {
    result: { tools: Array<{ name: string }> };
  };
  const names = body.result.tools.map((tool) => tool.name);
  if (!names.includes("computer_shell_exec")) {
    throw new Error("Expected published MCP computer_shell_exec tool");
  }
  if (!names.includes("computer_session_create")) {
    throw new Error("Expected published MCP computer_session_create tool");
  }
});

Deno.test("sandbox host published MCP requires published auth", async () => {
  const { env, mcpCalls } = createEnv();

  const response = await fetchWorker(env, "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });

  assertEquals(response.status, 401);
  assertEquals(mcpCalls, []);
});

Deno.test("sandbox host published MCP rejects host auth token", async () => {
  const { env, mcpCalls } = createEnv();

  const hostTokenResponse = await fetchWorker(env, "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hostAuthHeaders(),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });
  assertEquals(hostTokenResponse.status, 401);
  assertEquals(mcpCalls, []);
});

Deno.test("sandbox host published MCP fails closed when publication auth token is missing", async () => {
  const { env, mcpCalls } = createEnv({ publishedMcpAuthToken: null });

  const response = await fetchWorker(env, "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hostAuthHeaders(),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });

  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    error: "Published MCP auth token is not configured",
  });
  assertEquals(mcpCalls, []);
});

Deno.test("sandbox host published MCP auto-creates a session and proxies tool calls", async () => {
  const { env, mcpCalls } = createEnv();

  const response = await fetchWorker(env, "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...publishedMcpAuthHeaders(),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "computer_shell_exec",
        arguments: {
          command: "pwd",
          session_id: "agent-session-1",
          space_id: "space-1",
          user_id: "user-1",
        },
      },
    }),
  });

  assertEquals(response.status, 200);
  const body = await response.json() as {
    result: { content: Array<{ type: string; text: string }> };
  };
  assertEquals(body.result.content[0]?.type, "text");
  assertEquals(JSON.parse(body.result.content[0]!.text), {
    tool: "shell_exec",
    arguments: { command: "pwd" },
  });
  assertEquals(mcpCalls, [{
    path: "/mcp",
    authorization: `Bearer ${MCP_AUTH_TOKEN}`,
    body: {
      jsonrpc: "2.0",
      id: "published-mcp-call",
      method: "tools/call",
      params: {
        name: "shell_exec",
        arguments: { command: "pwd" },
      },
    },
  }]);
});
