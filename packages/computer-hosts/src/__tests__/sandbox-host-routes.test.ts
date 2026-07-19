import { expect, test } from "bun:test";
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
const APP_SESSION_SECRET = "test-app-session-secret";
const OIDC_ISSUER_URL = "https://accounts.example.test";
const OIDC_CLIENT_ID = "computer-client";
const OIDC_CLIENT_SECRET = "computer-client-secret";
const INSTALLATION_ID = "inst_computer";

function hostAuthHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${HOST_AUTH_TOKEN}` };
}

function createEnv(
  options: {
    hostAuthToken?: string | null;
    publishedMcpAuthToken?: string | null;
    mcpAuthToken?: string | null;
    trustRoutedGuiApi?: boolean;
    appAuthRequired?: boolean;
    appAuthConfig?: boolean;
    launchConfig?: boolean;
    interfaceOAuth?: boolean;
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
  const doNames: string[] = [];
  const env = {
    SANDBOX_CONTAINER: {
      idFromName(name: string) {
        currentSessionId = name;
        doNames.push(name);
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
  if (options.interfaceOAuth) {
    env.OIDC_ISSUER_URL = OIDC_ISSUER_URL;
    env.MCP_URL = "https://sandbox-host.test/mcp";
    env.APP_WORKSPACE_ID = "ws_interface";
    env.APP_CAPSULE_ID = "cap_interface";
  }
  if (options.appAuthRequired) env.APP_AUTH_REQUIRED = "1";
  if (options.appAuthRequired && options.appAuthConfig !== false) {
    env.APP_SESSION_SECRET = APP_SESSION_SECRET;
    env.OIDC_ISSUER_URL = OIDC_ISSUER_URL;
    env.OIDC_CLIENT_ID = OIDC_CLIENT_ID;
    env.OIDC_CLIENT_SECRET = OIDC_CLIENT_SECRET;
  }
  if (options.appAuthRequired && options.launchConfig !== false) {
    env.ACCOUNTS_BASE_URL = OIDC_ISSUER_URL;
    env.INSTALL_LAUNCH_INSTALLATION_ID = INSTALLATION_ID;
    env.INSTALL_LAUNCH_CONSUME_PATH = "/gui/api/auth/launch";
  }

  return { env, mcpCalls, doNames };
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

function fetchRequestUrl(request: RequestInfo | URL): string {
  return request instanceof Request ? request.url : String(request);
}

type TestFetch = (
  request: RequestInfo | URL,
  init?: RequestInit,
) => Response | Promise<Response>;

async function withFetch<T>(fakeFetch: TestFetch, fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    value: fakeFetch,
    configurable: true,
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      value: originalFetch,
      configurable: true,
    });
  }
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

async function signEs256Jwt(input: {
  kid: string;
  claims: Record<string, unknown>;
  privateKey: CryptoKey;
}): Promise<string> {
  const signingInput = [
    base64UrlEncodeJson({ alg: "ES256", typ: "JWT", kid: input.kid }),
    base64UrlEncodeJson(input.claims),
  ].join(".");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    input.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

function sessionCookieFromSetCookie(setCookie: string | null): string {
  const match = setCookie?.match(/takos_computer_session=[^;,]+/);
  if (!match) throw new Error("Expected GUI session cookie");
  return match[0];
}

/**
 * Mint a sealed GUI session cookie for an arbitrary principal by driving the
 * launch-token flow with a stubbed `launch-token/consume` upstream.
 */
function mintGuiSessionCookie(
  env: SandboxHostEnv,
  claims: { sub: string; spaceId?: string },
): Promise<string> {
  return withFetch((request) => {
    const url = new URL(fetchRequestUrl(request));
    if (url.pathname.endsWith("/launch-token/consume")) {
      return Promise.resolve(Response.json({
        consumed: true,
        sub: claims.sub,
        space_id: claims.spaceId,
      }));
    }
    return Promise.resolve(Response.json({ error: "unexpected" }, {
      status: 404,
    }));
  }, async () => {
    const response = await fetchWorker(
      env,
      "/gui/api/auth/launch?return_to=%2Fgui&launch_token=tok",
    );
    return sessionCookieFromSetCookie(response.headers.get("set-cookie"));
  });
}

test("sandbox host serves published GUI app routes", async () => {
  const { env } = createEnv();

  const unauthenticatedResponse = await fetchWorker(env, "/gui");
  expect(unauthenticatedResponse.status).toEqual(401);

  const authResponse = await fetchWorker(
    env,
    `/gui?authToken=${encodeURIComponent(HOST_AUTH_TOKEN)}`,
  );
  expect(authResponse.status).toEqual(302);
  expect(authResponse.headers.get("location")).toEqual("/gui");
  const cookie = authResponse.headers.get("set-cookie");
  if (!cookie?.includes("takos_computer_admin_token=")) {
    throw new Error("Expected GUI admin auth cookie");
  }

  const indexResponse = await fetchWorker(env, "/gui", {
    headers: { Cookie: cookie },
  });
  expect(indexResponse.status).toEqual(200);
  expect(indexResponse.headers.get("content-type")).toEqual("text/html; charset=utf-8",
  );
  const html = await indexResponse.text();
  if (!html.includes('<div id="app"></div>')) {
    throw new Error("Expected GUI HTML shell");
  }

  const fallbackResponse = await fetchWorker(env, "/gui/sessions/session-1", {
    headers: { Cookie: cookie },
  });
  expect(fallbackResponse.status).toEqual(200);
  expect(fallbackResponse.headers.get("content-type")).toEqual("text/html; charset=utf-8",
  );

  const iconResponse = await fetchWorker(env, "/icons/computer.svg");
  expect(iconResponse.status).toEqual(200);
  expect(iconResponse.headers.get("content-type")).toEqual("image/svg+xml");
  const iconBody = await iconResponse.text();
  if (!iconBody.includes('aria-label="Computer"')) {
    throw new Error("Expected computer icon SVG");
  }
});

test("sandbox host rejects routed marker header without GUI auth", async () => {
  const { env } = createEnv();
  const response = await fetchWorker(env, "/gui", {
    headers: { "X-Takos-Internal-Marker": "1" },
  });

  expect(response.status).toEqual(401);
});

test("sandbox host accepts trusted Takos-routed GUI requests when enabled", async () => {
  const { env } = createEnv({ trustRoutedGuiApi: true });
  const response = await fetchWorker(env, "/gui", {
    headers: { "X-Takos-Internal-Marker": "1" },
  });

  expect(response.status).toEqual(200);
  expect(response.headers.get("content-type")).toEqual("text/html; charset=utf-8",
  );
});

test("sandbox host redirects GUI users to OIDC login when app auth is required", async () => {
  const { env } = createEnv({ appAuthRequired: true });

  const response = await fetchWorker(env, "/gui");

  expect(response.status).toEqual(302);
  expect(response.headers.get("location")).toEqual("/gui/api/auth/login?return_to=%2Fgui",
  );
});

test("sandbox host OIDC login creates state cookie and PKCE redirect", async () => {
  const { env } = createEnv({ appAuthRequired: true });

  await withFetch((request) => {
    const url = new URL(fetchRequestUrl(request));
    if (url.pathname === "/.well-known/openid-configuration") {
      return Promise.resolve(Response.json({
        issuer: OIDC_ISSUER_URL,
        authorization_endpoint: `${OIDC_ISSUER_URL}/oauth/authorize`,
        token_endpoint: `${OIDC_ISSUER_URL}/oauth/token`,
        userinfo_endpoint: `${OIDC_ISSUER_URL}/oauth/userinfo`,
        jwks_uri: `${OIDC_ISSUER_URL}/oauth/jwks`,
      }));
    }
    return Promise.resolve(Response.json({ error: "unexpected" }, {
      status: 404,
    }));
  }, async () => {
    const response = await fetchWorker(
      env,
      "/gui/api/auth/login?return_to=https%3A%2F%2Fevil.example%2F",
    );

    expect(response.status).toEqual(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toEqual(OIDC_ISSUER_URL);
    expect(location.pathname).toEqual("/oauth/authorize");
    expect(location.searchParams.get("response_type")).toEqual("code");
    expect(location.searchParams.get("client_id")).toEqual(OIDC_CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toEqual("https://sandbox-host.test/gui/api/auth/callback",
    );
    expect(location.searchParams.get("code_challenge_method")).toEqual("S256",
    );
    if (!location.searchParams.get("state")) {
      throw new Error("Expected OAuth state");
    }
    if (!location.searchParams.get("nonce")) {
      throw new Error("Expected OIDC nonce");
    }
    const cookie = response.headers.get("set-cookie");
    if (
      !cookie?.includes("takos_computer_oauth_state=") ||
      !cookie.includes("Path=/gui/api/auth") ||
      !cookie.includes("HttpOnly") ||
      !cookie.includes("SameSite=Lax") ||
      !cookie.includes("Secure")
    ) {
      throw new Error(`Unexpected state cookie: ${cookie}`);
    }
  });
});

test("sandbox host OIDC callback verifies id token and creates GUI session", async () => {
  const { env } = createEnv({ appAuthRequired: true });
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const kid = "test-key";
  let expectedNonce = "";
  let tokenParams: URLSearchParams | null = null;

  await withFetch(async (request, init) => {
    const url = new URL(fetchRequestUrl(request));
    if (url.pathname === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: OIDC_ISSUER_URL,
        authorization_endpoint: `${OIDC_ISSUER_URL}/oauth/authorize`,
        token_endpoint: `${OIDC_ISSUER_URL}/oauth/token`,
        userinfo_endpoint: `${OIDC_ISSUER_URL}/oauth/userinfo`,
        jwks_uri: `${OIDC_ISSUER_URL}/oauth/jwks`,
      });
    }
    if (url.pathname === "/oauth/token") {
      tokenParams = new URLSearchParams(String(init?.body));
      const now = Math.floor(Date.now() / 1000);
      const idToken = await signEs256Jwt({
        kid,
        privateKey: keyPair.privateKey,
        claims: {
          iss: OIDC_ISSUER_URL,
          sub: "subject-1",
          aud: OIDC_CLIENT_ID,
          nonce: expectedNonce,
          iat: now,
          exp: now + 300,
          name: "Ada",
          takosumi: {
            account_id: "acct_1",
            space_id: "space-1",
            app_id: "jp.takos.computer",
            role: "owner",
          },
        },
      });
      return Response.json({
        access_token: "access-token",
        token_type: "Bearer",
        id_token: idToken,
      });
    }
    if (url.pathname === "/oauth/jwks") {
      return Response.json({
        keys: [{ ...publicJwk, kid, use: "sig", alg: "ES256" }],
      });
    }
    if (url.pathname === "/oauth/userinfo") {
      return Response.json({ sub: "subject-1", name: "Ada" });
    }
    return Response.json({ error: "unexpected" }, { status: 404 });
  }, async () => {
    const loginResponse = await fetchWorker(
      env,
      "/gui/api/auth/login?return_to=https%3A%2F%2Fevil.example%2F",
    );
    const loginLocation = new URL(loginResponse.headers.get("location")!);
    expectedNonce = loginLocation.searchParams.get("nonce")!;
    const state = loginLocation.searchParams.get("state")!;
    const stateCookie = loginResponse.headers.get("set-cookie")!;

    const callbackResponse = await fetchWorker(
      env,
      `/gui/api/auth/callback?code=code-1&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: stateCookie } },
    );

    expect(callbackResponse.status).toEqual(302);
    expect(callbackResponse.headers.get("location")).toEqual("/gui");
    const setCookie = callbackResponse.headers.get("set-cookie");
    if (
      !setCookie?.includes("takos_computer_session=") ||
      !setCookie.includes("takos_computer_oauth_state=;") ||
      !setCookie.includes("Path=/gui") ||
      !setCookie.includes("HttpOnly")
    ) {
      throw new Error(`Unexpected callback cookies: ${setCookie}`);
    }
    expect(tokenParams?.get("redirect_uri")).toEqual("https://sandbox-host.test/gui/api/auth/callback",
    );
    if (!tokenParams?.get("code_verifier")) {
      throw new Error("Expected PKCE code verifier");
    }

    const sessionCookie = sessionCookieFromSetCookie(setCookie);
    const meResponse = await fetchWorker(env, "/gui/api/auth/me", {
      headers: { Cookie: sessionCookie },
    });
    expect(meResponse.status).toEqual(200);
    expect(await meResponse.json()).toEqual({
      authenticated: true,
      subject: "subject-1",
      name: "Ada",
      accountId: "acct_1",
      spaceId: "space-1",
      appId: "jp.takos.computer",
      role: "owner",
    });
  });
});

test("sandbox host OIDC callback rejects invalid state", async () => {
  const { env } = createEnv({ appAuthRequired: true });

  const response = await fetchWorker(
    env,
    "/gui/api/auth/callback?code=code-1&state=bad-state",
  );

  expect(response.status).toEqual(400);
  expect(await response.json()).toEqual({ error: "Invalid OAuth state" });
});

test("sandbox host reports missing OIDC env when app auth is required", async () => {
  const { env } = createEnv({
    appAuthRequired: true,
    appAuthConfig: false,
  });

  const loginResponse = await fetchWorker(env, "/gui/api/auth/login");
  expect(loginResponse.status).toEqual(503);
  expect(await loginResponse.json()).toEqual({
    error: "GUI app auth is not configured",
    missing: [
      "APP_SESSION_SECRET",
      "OIDC_ISSUER_URL",
      "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET",
    ],
  });

  const readyResponse = await fetchWorker(env, "/readyz");
  expect(readyResponse.status).toEqual(503);
  const readyBody = await readyResponse.json() as { missingBindings: string[] };
  if (!readyBody.missingBindings.includes("APP_SESSION_SECRET")) {
    throw new Error("Expected app auth env in readyz missing bindings");
  }
});

test("sandbox host consumes launch token into GUI session", async () => {
  const { env } = createEnv({ appAuthRequired: true });
  let consumedUrl = "";
  let consumedBody: Record<string, unknown> | null = null;

  await withFetch((request, init) => {
    const url = new URL(fetchRequestUrl(request));
    if (url.pathname.endsWith("/launch-token/consume")) {
      consumedUrl = url.toString();
      consumedBody = JSON.parse(String(init?.body));
      return Promise.resolve(Response.json({
        consumed: true,
        sub: "launch-subject",
        account_id: "acct_1",
        space_id: "space-1",
        app_id: "jp.takos.computer",
        role: "owner",
      }));
    }
    return Promise.resolve(Response.json({ error: "unexpected" }, {
      status: 404,
    }));
  }, async () => {
    const response = await fetchWorker(
      env,
      "/gui/api/auth/launch?return_to=%2Fgui%2Fsandbox%2Fsession-1&launch_token=launch-1",
    );

    expect(response.status).toEqual(302);
    expect(response.headers.get("location")).toEqual("/gui/sandbox/session-1");
    expect(consumedUrl).toEqual(`${OIDC_ISSUER_URL}/v1/installations/${INSTALLATION_ID}/launch-token/consume`,
    );
    expect(consumedBody?.token).toEqual("launch-1");
    const redirectUri = new URL(String(consumedBody?.redirect_uri));
    expect(redirectUri.origin).toEqual("https://sandbox-host.test");
    expect(redirectUri.pathname).toEqual("/gui/api/auth/launch");
    expect(redirectUri.searchParams.get("return_to")).toEqual("/gui/sandbox/session-1",
    );
    expect(redirectUri.searchParams.has("launch_token")).toEqual(false);

    const sessionCookie = sessionCookieFromSetCookie(
      response.headers.get("set-cookie"),
    );
    const listResponse = await fetchWorker(env, "/gui/api/sandbox-sessions", {
      headers: { Cookie: sessionCookie },
    });
    expect(listResponse.status).toEqual(200);
  });
});

test("sandbox host does not create session for invalid launch token", async () => {
  const { env } = createEnv({ appAuthRequired: true });

  await withFetch((request) => {
    const url = new URL(fetchRequestUrl(request));
    if (url.pathname.endsWith("/launch-token/consume")) {
      return Promise.resolve(Response.json({
        error: "launch_token_replayed",
      }, { status: 410 }));
    }
    return Promise.resolve(Response.json({ error: "unexpected" }, {
      status: 404,
    }));
  }, async () => {
    const response = await fetchWorker(
      env,
      "/gui/api/auth/launch?return_to=%2Fgui&launch_token=replayed",
    );

    expect(response.status).toEqual(302);
    expect(response.headers.get("location")).toEqual("/gui/api/auth/login?return_to=%2Fgui",
    );
    expect(response.headers.get("set-cookie")).toEqual(null);
  });
});

test("sandbox host health reports missing required bindings", async () => {
  const { env } = createEnv({
    hostAuthToken: null,
    mcpAuthToken: null,
    publishedMcpAuthToken: null,
  });
  delete env.SESSION_INDEX;

  const response = await fetchWorker(env, "/health");

  expect(response.status).toEqual(503);
  expect(await response.json()).toEqual({
    status: "misconfigured",
    service: "takos-sandbox-host",
    missingBindings: [
      "SANDBOX_HOST_AUTH_TOKEN",
      "MCP_AUTH_TOKEN",
      "PUBLISHED_MCP_AUTH_TOKEN or Interface OAuth configuration",
      "SESSION_INDEX",
    ],
  });
});

test("sandbox host healthz is bootstrap-safe while readyz is strict", async () => {
  const { env } = createEnv({
    hostAuthToken: null,
    mcpAuthToken: null,
    publishedMcpAuthToken: null,
  });
  delete env.SESSION_INDEX;

  const healthzResponse = await fetchWorker(env, "/healthz");
  expect(healthzResponse.status).toEqual(200);
  expect(await healthzResponse.json()).toEqual({
    status: "ok",
    service: "takos-sandbox-host",
    ready: false,
    missingBindings: [
      "SANDBOX_HOST_AUTH_TOKEN",
      "MCP_AUTH_TOKEN",
      "PUBLISHED_MCP_AUTH_TOKEN or Interface OAuth configuration",
      "SESSION_INDEX",
    ],
  });

  const readyzResponse = await fetchWorker(env, "/readyz");
  expect(readyzResponse.status).toEqual(503);
});

test("sandbox host does not use host auth token as container MCP auth fallback", async () => {
  const { env } = createEnv({ mcpAuthToken: null });

  const response = await fetchWorker(env, "/health");

  expect(response.status).toEqual(503);
  expect(await response.json()).toEqual({
    status: "misconfigured",
    service: "takos-sandbox-host",
    missingBindings: ["MCP_AUTH_TOKEN"],
  });
});

test("sandbox host readyz fails when published MCP auth token is missing", async () => {
  const { env } = createEnv({ publishedMcpAuthToken: null });

  const response = await fetchWorker(env, "/readyz");

  expect(response.status).toEqual(503);
  expect(await response.json()).toEqual({
    status: "misconfigured",
    service: "takos-sandbox-host",
    missingBindings: [
      "PUBLISHED_MCP_AUTH_TOKEN or Interface OAuth configuration",
    ],
  });
});

test("sandbox host supports published GUI compatibility routes", async () => {
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
  expect(createResponse.status).toEqual(201);
  expect(await createResponse.json()).toEqual({
    ok: true,
    proxyToken: SESSION_PROXY_TOKEN,
  });

  const listResponse = await fetchWorker(env, "/gui/api/sandbox-sessions", {
    headers: hostAuthHeaders(),
  });
  expect(listResponse.status).toEqual(200);
  const listBody = await listResponse.json() as { sessions: unknown[] };
  expect(listBody.sessions.length).toEqual(1);

  const getResponse = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1",
    { headers: hostAuthHeaders() },
  );
  expect(getResponse.status).toEqual(200);
  const getBody = await getResponse.json() as { sessionId: string };
  expect(getBody.sessionId).toEqual("session-1");

  const deleteResponse = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1",
    { method: "DELETE", headers: hostAuthHeaders() },
  );
  expect(deleteResponse.status).toEqual(200);
  expect(await deleteResponse.json()).toEqual({ ok: true });
});

test("sandbox host accepts GUI admin auth cookie for dashboard APIs", async () => {
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
  expect(createResponse.status).toEqual(201);

  const listResponse = await fetchWorker(env, "/gui/api/sandbox-sessions", {
    headers: { Cookie: cookie },
  });
  expect(listResponse.status).toEqual(200);
  const listBody = await listResponse.json() as { sessions: unknown[] };
  expect(listBody.sessions.length).toEqual(1);
});

test("sandbox host forces GUI session owner on create and rejects foreign session ids", async () => {
  const { env } = createEnv({ appAuthRequired: true });

  // A host admin pre-creates a session owned by a different principal.
  const preCreate = await fetchWorker(env, "/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...hostAuthHeaders() },
    body: JSON.stringify({
      sessionId: "victim-session",
      spaceId: "space-victim",
      userId: "victim-user",
    }),
  });
  expect(preCreate.status).toEqual(201);

  const cookie = await mintGuiSessionCookie(env, {
    sub: "user-a",
    spaceId: "space-a",
  });

  // A GUI caller cannot mint a session owned by another user/space: the
  // client-supplied userId/spaceId are ignored and forced to the principal.
  const createResponse = await fetchWorker(env, "/gui/api/sandbox-create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      sessionId: "user-a-session",
      spaceId: "space-b",
      userId: "user-b",
    }),
  });
  expect(createResponse.status).toEqual(201);

  const getResponse = await fetchWorker(
    env,
    "/gui/api/sandbox-session/user-a-session",
    { headers: { Cookie: cookie } },
  );
  expect(getResponse.status).toEqual(200);
  const state = await getResponse.json() as {
    userId: string;
    spaceId: string;
  };
  expect(state.userId).toEqual("user-a");
  expect(state.spaceId).toEqual("space-a");

  // A GUI caller cannot target a sessionId already owned by another principal.
  const clobber = await fetchWorker(env, "/gui/api/sandbox-create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      sessionId: "victim-session",
      spaceId: "space-a",
      userId: "user-a",
    }),
  });
  expect(clobber.status).toEqual(409);
});

test("sandbox host does not let a space-less GUI session forge spaceId", async () => {
  const { env } = createEnv({ appAuthRequired: true });

  // A GUI session with NO space claim (the IdP / launch flow omitted space_id).
  const cookie = await mintGuiSessionCookie(env, { sub: "user-a" });

  // The client tries to supply a space; it must NOT survive into the session
  // (otherwise it would spoof TAKOS_SPACE_ID for the sandbox container).
  const createResponse = await fetchWorker(env, "/gui/api/sandbox-create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      sessionId: "user-a-session",
      spaceId: "space-victim",
      userId: "user-a",
    }),
  });
  expect(createResponse.status).toEqual(201);

  const getResponse = await fetchWorker(
    env,
    "/gui/api/sandbox-session/user-a-session",
    { headers: { Cookie: cookie } },
  );
  expect(getResponse.status).toEqual(200);
  const state = await getResponse.json() as { userId: string; spaceId: string };
  expect(state.userId).toEqual("user-a");
  // Authoritative empty space — the client-supplied "space-victim" was dropped.
  expect(state.spaceId).toEqual("");
});

test("sandbox host authorizes consistently when a stale admin cookie rides along a valid OIDC session", async () => {
  const { env } = createEnv({ appAuthRequired: true });
  const sessionCookie = await mintGuiSessionCookie(env, {
    sub: "user-a",
    spaceId: "space-a",
  });
  // The user created a session through their valid OIDC GUI session.
  const createResponse = await fetchWorker(env, "/gui/api/sandbox-create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({
      sessionId: "user-a-session",
      spaceId: "space-a",
      userId: "user-a",
    }),
  });
  expect(createResponse.status).toEqual(201);

  // Now a STALE admin-token cookie rides along the same valid session cookie
  // (e.g. opened the dashboard once via ?authToken, then the admin token
  // rotated server-side). It must not suppress the valid OIDC session: every
  // verb stays consistent for the same authenticated user.
  const cookie = `takos_computer_admin_token=${
    encodeURIComponent("stale-rotated-admin-token")
  }; ${sessionCookie}`;

  const listResponse = await fetchWorker(env, "/gui/api/sandbox-sessions", {
    headers: { Cookie: cookie },
  });
  expect(listResponse.status).toEqual(200);

  const getResponse = await fetchWorker(
    env,
    "/gui/api/sandbox-session/user-a-session",
    { headers: { Cookie: cookie } },
  );
  expect(getResponse.status).toEqual(200);

  const mcpResponse = await fetchWorker(
    env,
    "/gui/api/sandbox-session/user-a-session/mcp",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ jsonrpc: "2.0", method: "process_list" }),
    },
  );
  expect(mcpResponse.status).toEqual(200);
});

test("sandbox host enforces a per-user live-session quota", async () => {
  const { env } = createEnv({ appAuthRequired: true });
  env.MAX_SANDBOX_SESSIONS_PER_USER = "2";
  const cookie = await mintGuiSessionCookie(env, {
    sub: "user-a",
    spaceId: "space-a",
  });
  const create = (sessionId: string) =>
    fetchWorker(env, "/gui/api/sandbox-create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ sessionId, spaceId: "space-a", userId: "user-a" }),
    });

  expect((await create("s1")).status).toEqual(201);
  expect((await create("s2")).status).toEqual(201);
  // The 3rd distinct session exceeds the cap.
  expect((await create("s3")).status).toEqual(429);
  // Re-creating an already-owned session is not blocked by the quota.
  expect((await create("s1")).status).toEqual(201);
});

test("sandbox host rejects a reserved published-scope sessionId on create", async () => {
  const { env } = createEnv();
  const response = await fetchWorker(env, "/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...hostAuthHeaders() },
    body: JSON.stringify({
      sessionId: "pmcp-deadbeef:x",
      spaceId: "space-1",
      userId: "user-1",
    }),
  });
  expect(response.status).toEqual(400);
});

test("sandbox host compensates (destroys) a session whose index write fails", async () => {
  const { env } = createEnv();
  // KV that fails the post-create index write.
  const failingKv = {
    get: () => Promise.resolve(null),
    put: () => Promise.reject(new Error("kv put boom")),
    delete: () => Promise.resolve(),
    list: () =>
      Promise.resolve({ keys: [], list_complete: true as const }),
  };
  env.SESSION_INDEX = failingKv as unknown as SandboxHostEnv["SESSION_INDEX"];

  const createResponse = await fetchWorker(env, "/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...hostAuthHeaders() },
    body: JSON.stringify({
      sessionId: "session-1",
      spaceId: "space-1",
      userId: "user-1",
    }),
  });
  expect(createResponse.status).toEqual(500);

  // The session was torn down (compensated), not left as an orphaned container.
  const getResponse = await fetchWorker(env, "/session/session-1", {
    headers: hostAuthHeaders(),
  });
  expect(getResponse.status).toEqual(404);
});

test("sandbox host rejects unauthenticated session create", async () => {
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

  expect(response.status).toEqual(401);
});

test("sandbox host rejects routed marker header without API auth", async () => {
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
  expect(createResponse.status).toEqual(401);

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
  expect(mcpResponse.status).toEqual(401);
  expect(mcpCalls).toEqual([]);
});

test("sandbox host accepts trusted Takos-routed dashboard API and MCP requests", async () => {
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
  expect(createResponse.status).toEqual(201);

  const listResponse = await fetchWorker(env, "/gui/api/sandbox-sessions", {
    headers: { "X-Takos-Internal-Marker": "1" },
  });
  expect(listResponse.status).toEqual(200);
  const listBody = await listResponse.json() as { sessions: unknown[] };
  expect(listBody.sessions.length).toEqual(1);

  const sessionResponse = await fetchWorker(env, "/session/session-1", {
    headers: { "X-Takos-Internal-Marker": "1" },
  });
  expect(sessionResponse.status).toEqual(200);
  const sessionBody = await sessionResponse.json() as { sessionId: string };
  expect(sessionBody.sessionId).toEqual("session-1");

  const mcpResponse = await fetchWorker(
    env,
    "/gui/api/sandbox-session/session-1/mcp",
    {
      method: "POST",
      headers: trustedHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "process_list" }),
    },
  );
  expect(mcpResponse.status).toEqual(200);
  expect(mcpCalls).toEqual([{
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
  expect(sessionMcpResponse.status).toEqual(200);
  expect(mcpCalls).toEqual([
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

test("sandbox host fails closed when host auth token is missing", async () => {
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

  expect(response.status).toEqual(503);
});

test("sandbox host supports published GUI MCP compatibility route", async () => {
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

  expect(response.status).toEqual(200);
  expect(await response.json()).toEqual({
    ok: true,
    path: "/mcp",
    body: { jsonrpc: "2.0", method: "process_list" },
  });
  expect(mcpCalls).toEqual([{
    path: "/mcp",
    authorization: `Bearer ${MCP_AUTH_TOKEN}`,
    body: { jsonrpc: "2.0", method: "process_list" },
  }]);
});

test("sandbox host rejects proxyToken query auth for GUI session bootstrap", async () => {
  const { env } = createEnv();

  const response = await fetchWorker(
    env,
    `/gui/sandbox/session-1?proxyToken=${
      encodeURIComponent(SESSION_PROXY_TOKEN)
    }`,
  );

  expect(response.status).toEqual(401);
  expect(response.headers.get("set-cookie")).toEqual(null);
});

test("sandbox host rejects proxyToken query auth for MCP route", async () => {
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

  expect(response.status).toEqual(401);
  expect(mcpCalls).toEqual([]);
});

test("sandbox host accepts explicit proxy token header for MCP route", async () => {
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

  expect(response.status).toEqual(200);
  expect(mcpCalls).toEqual([{
    path: "/mcp",
    authorization: `Bearer ${MCP_AUTH_TOKEN}`,
    body: { jsonrpc: "2.0", method: "process_list" },
  }]);
});

test("sandbox host rejects session MCP GET stream requests without proxying", async () => {
  const { env, mcpCalls } = createEnv();

  const response = await fetchWorker(
    env,
    "/session/session-1/mcp",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${SESSION_PROXY_TOKEN}`,
      },
    },
  );

  expect(response.status).toEqual(405);
  expect(response.headers.get("allow")).toEqual("POST, OPTIONS");
  expect(await response.json()).toEqual({
    error:
      "MCP Streamable HTTP requests must use POST; server-to-client GET streams are not supported by this endpoint",
  });
  expect(mcpCalls).toEqual([]);
});

test("sandbox host rejects GUI MCP GET stream requests without proxying", async () => {
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

  expect(response.status).toEqual(405);
  expect(response.headers.get("allow")).toEqual("POST, OPTIONS");
  expect(await response.json()).toEqual({
    error:
      "MCP Streamable HTTP requests must use POST; server-to-client GET streams are not supported by this endpoint",
  });
  expect(mcpCalls).toEqual([]);
});

test("sandbox host allows session MCP OPTIONS without proxying", async () => {
  const { env, mcpCalls } = createEnv();

  const response = await fetchWorker(
    env,
    "/session/session-1/mcp",
    { method: "OPTIONS" },
  );

  expect(response.status).toEqual(204);
  expect(response.headers.get("allow")).toEqual("POST, OPTIONS");
  expect(mcpCalls).toEqual([]);
});

test("sandbox host rejects MCP without a valid session proxy token", async () => {
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

  expect(response.status).toEqual(401);
  expect(mcpCalls).toEqual([]);
});

test("sandbox host fails closed when no container MCP auth token source is configured", async () => {
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

  expect(response.status).toEqual(503);
  expect(mcpCalls).toEqual([]);
});

test("sandbox host published MCP lists computer tools with published auth", async () => {
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

  expect(response.status).toEqual(200);
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

test("sandbox host published MCP accepts exact Interface OAuth and uses stable owner scope", async () => {
  const { env, doNames } = createEnv({
    publishedMcpAuthToken: null,
    interfaceOAuth: true,
  });
  const userInfo = {
    token_use: "interface_oauth",
    sub: "svc_agent",
    aud: "https://sandbox-host.test/mcp",
    scope: "mcp.invoke",
    takosumi: {
      workspace_id: "ws_interface",
      capsule_id: "cap_interface",
      interface_id: "if_computer_mcp",
      interface_binding_id: "ifb_agent",
      interface_resolved_revision: 2,
    },
  };

  await withFetch(async (input, init) => {
    expect(fetchRequestUrl(input)).toBe(
      "https://accounts.example.test/oauth/userinfo",
    );
    expect(new Headers(init?.headers).get("authorization")).toMatch(
      /^Bearer taksrv_/u,
    );
    return Response.json(userInfo);
  }, async () => {
    const ready = await fetchWorker(env, "/readyz");
    expect(ready.status).toBe(200);

    for (const token of ["taksrv_first", "taksrv_rotated"]) {
      const response = await fetchWorker(env, "/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: token,
          method: "tools/call",
          params: {
            name: "computer_session_create",
            arguments: {
              session_id: "shared-session",
              space_id: "spoofed-space",
              user_id: "spoofed-user",
            },
          },
        }),
      });
      expect(response.status).toBe(200);
      const payload = await response.json() as {
        result: { content: Array<{ text: string }> };
      };
      expect(JSON.parse(payload.result.content[0]!.text)).toMatchObject({
        session_id: "shared-session",
        space_id: "ws_interface",
        user_id: "svc_agent",
      });
    }
  });

  expect(new Set(doNames.filter((name) => name.includes("shared-session"))).size)
    .toBe(1);
});

test("sandbox host published MCP requires published auth", async () => {
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

  expect(response.status).toEqual(401);
  expect(mcpCalls).toEqual([]);
});

test("sandbox host published MCP rejects host auth token", async () => {
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
  expect(hostTokenResponse.status).toEqual(401);
  expect(mcpCalls).toEqual([]);
});

test("sandbox host published MCP fails closed when publication auth token is missing", async () => {
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

  expect(response.status).toEqual(503);
  expect(await response.json()).toEqual({
    error: "Direct MCP auth is not configured",
  });
  expect(mcpCalls).toEqual([]);
});

test("sandbox host published MCP auto-creates a session and proxies tool calls", async () => {
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

  expect(response.status).toEqual(200);
  const body = await response.json() as {
    result: { content: Array<{ type: string; text: string }> };
  };
  expect(body.result.content[0]?.type).toEqual("text");
  expect(JSON.parse(body.result.content[0]!.text)).toEqual({
    tool: "shell_exec",
    arguments: { command: "pwd" },
  });
  expect(mcpCalls).toEqual([{
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

test("sandbox host published MCP returns canonical -32603 when a tool handler throws", async () => {
  // The published and in-container MCP servers share one envelope; a tool/call
  // handler failure must surface as JSON-RPC -32603 (Internal error) on both,
  // not the previously-drifted -32000. Omitting the container MCP auth token
  // makes computer_shell_exec throw before it can proxy.
  const { env } = createEnv({ mcpAuthToken: null });

  const response = await fetchWorker(env, "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...publishedMcpAuthHeaders(),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "computer_shell_exec",
        arguments: { command: "pwd", session_id: "agent-session-1" },
      },
    }),
  });

  expect(response.status).toEqual(200);
  const body = await response.json() as {
    error?: { code: number; message: string };
  };
  expect(body.error?.code).toEqual(-32603);
});

test("sandbox host published MCP scopes the DO name to the token but reports the logical session id", async () => {
  const { env, doNames } = createEnv();

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
        name: "computer_session_create",
        arguments: { session_id: "agent-session-1", space_id: "space-1" },
      },
    }),
  });

  expect(response.status).toEqual(200);
  const body = await response.json() as {
    result: { content: Array<{ type: string; text: string }> };
  };
  const state = JSON.parse(body.result.content[0]!.text) as {
    session_id: string;
  };
  // Caller sees the logical id they passed.
  expect(state.session_id).toEqual("agent-session-1");
  // But the Durable Object is addressed by a token-scoped name, never the
  // raw caller-supplied session id.
  if (doNames.length === 0) {
    throw new Error("Expected at least one DO name to be resolved");
  }
  for (const name of doNames) {
    if (name === "agent-session-1") {
      throw new Error(
        "Published MCP must not address the DO by the raw caller session id",
      );
    }
    if (!name.startsWith("pmcp-") || !name.endsWith(":agent-session-1")) {
      throw new Error(`Unexpected DO name shape: ${name}`);
    }
  }
});

test("sandbox host published MCP isolates sessions across distinct tokens with the same session id", async () => {
  // Two callers holding different published tokens use the same logical
  // session id; they must resolve to different Durable Objects so neither
  // can address or destroy the other's session.
  const a = createEnv({ publishedMcpAuthToken: "token-a" });
  const b = createEnv({ publishedMcpAuthToken: "token-b" });

  const callDestroy = (env: SandboxHostEnv, token: string) =>
    fetchWorker(env, "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "computer_session_destroy",
          arguments: { session_id: "shared-id" },
        },
      }),
    });

  const resA = await callDestroy(a.env, "token-a");
  const resB = await callDestroy(b.env, "token-b");
  expect(resA.status).toEqual(200);
  expect(resB.status).toEqual(200);

  const nameA = a.doNames.at(-1);
  const nameB = b.doNames.at(-1);
  if (!nameA || !nameB) {
    throw new Error("Expected both callers to resolve a DO name");
  }
  if (nameA === nameB) {
    throw new Error(
      `Distinct tokens must not share a DO name for the same session id: ${nameA}`,
    );
  }
  if (!nameA.endsWith(":shared-id") || !nameB.endsWith(":shared-id")) {
    throw new Error("Both names should carry the logical session id suffix");
  }
});
