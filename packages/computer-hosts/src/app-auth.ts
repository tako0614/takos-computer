import type { Hono } from "hono";
import { constantTimeEqual } from "./crypto-utils.ts";
import type { SandboxHostEnv } from "./sandbox-session-types.ts";

const SESSION_COOKIE = "takos_computer_session";
const STATE_COOKIE = "takos_computer_oauth_state";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const STATE_MAX_AGE_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 60;
const DEFAULT_AUTH_PATH = "/gui/api/auth";
const DEFAULT_CALLBACK_PATH = `${DEFAULT_AUTH_PATH}/callback`;
const DEFAULT_LAUNCH_PATH = `${DEFAULT_AUTH_PATH}/launch`;

type AppRuntimeEnv = SandboxHostEnv;

type OAuthState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  exp: number;
};

export type GuiSession = {
  sub: string;
  name?: string;
  accountId?: string;
  spaceId?: string;
  appId?: string;
  role?: string;
  exp: number;
};

type OidcConfig = {
  required: boolean;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  jwksUri?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  sessionSecret?: string;
};

type OidcDiscoveryDocument = {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
};

type TokenResponse = {
  access_token?: string;
  id_token?: string;
};

type UserInfoResponse = {
  user?: { id?: string; name?: string };
  sub?: string;
  name?: string;
};

type IdTokenClaims = {
  iss?: unknown;
  sub?: unknown;
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  iat?: unknown;
  nbf?: unknown;
  nonce?: unknown;
  name?: unknown;
  email?: unknown;
  takosumi?: {
    account_id?: unknown;
    space_id?: unknown;
    app_id?: unknown;
    role?: unknown;
  };
};

function envValue(env: AppRuntimeEnv, name: string): string | undefined {
  const value = env[name as keyof AppRuntimeEnv];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function flagEnabled(env: AppRuntimeEnv, name: string): boolean {
  const value = envValue(env, name);
  return value ? ["1", "true", "yes"].includes(value.toLowerCase()) : false;
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

function appBaseUrl(request: Request, env: AppRuntimeEnv): string {
  const configured = envValue(env, "BASE_URL");
  if (configured) return normalizeIssuer(configured);
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function authConfig(env: AppRuntimeEnv): OidcConfig {
  const issuer = envValue(env, "OIDC_ISSUER_URL");
  return {
    required: flagEnabled(env, "APP_AUTH_REQUIRED"),
    issuer: issuer ? normalizeIssuer(issuer) : undefined,
    authorizationEndpoint: envValue(env, "OIDC_AUTHORIZATION_URL"),
    tokenEndpoint: envValue(env, "OIDC_TOKEN_URL"),
    userinfoEndpoint: envValue(env, "OIDC_USERINFO_URL"),
    jwksUri: envValue(env, "OIDC_JWKS_URL"),
    clientId: envValue(env, "OIDC_CLIENT_ID"),
    clientSecret: envValue(env, "OIDC_CLIENT_SECRET"),
    redirectUri: envValue(env, "OIDC_REDIRECT_URI"),
    sessionSecret: envValue(env, "APP_SESSION_SECRET"),
  };
}

export function guiAppAuthRequired(env: AppRuntimeEnv): boolean {
  return authConfig(env).required;
}

function authMissing(env: AppRuntimeEnv): string[] {
  const config = authConfig(env);
  if (!config.required) return [];
  const requiredValues: Array<[string, string | undefined]> = [
    ["APP_SESSION_SECRET", config.sessionSecret],
    ["OIDC_ISSUER_URL", config.issuer],
    ["OIDC_CLIENT_ID", config.clientId],
    ["OIDC_CLIENT_SECRET", config.clientSecret],
  ];
  return requiredValues.flatMap(([name, value]) => value ? [] : [name]);
}

export function appAuthMisconfigured(env: AppRuntimeEnv): Response | null {
  const missing = authMissing(env);
  if (missing.length === 0) return null;
  return Response.json({
    error: "GUI app auth is not configured",
    missing,
  }, { status: 503 });
}

function launchMissing(env: AppRuntimeEnv): string[] {
  const requiredValues: Array<[string, string | undefined]> = [
    ["APP_SESSION_SECRET", envValue(env, "APP_SESSION_SECRET")],
    ["ACCOUNTS_BASE_URL", envValue(env, "ACCOUNTS_BASE_URL")],
    [
      "INSTALL_LAUNCH_INSTALLATION_ID",
      envValue(env, "INSTALL_LAUNCH_INSTALLATION_ID"),
    ],
    [
      "INSTALL_LAUNCH_CONSUME_PATH",
      envValue(env, "INSTALL_LAUNCH_CONSUME_PATH"),
    ],
  ];
  return requiredValues.flatMap(([name, value]) => value ? [] : [name]);
}

function launchMisconfigured(env: AppRuntimeEnv): Response | null {
  const missing = launchMissing(env);
  if (missing.length === 0) return null;
  return Response.json({
    error: "Launch token auth is not configured",
    missing,
  }, { status: 503 });
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(value: string): Uint8Array | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
      Math.ceil(value.length / 4) * 4,
      "=",
    );
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function parseBase64UrlJson<T>(value: string): T | null {
  try {
    const bytes = base64UrlBytes(value);
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) as T : null;
  } catch {
    return null;
  }
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(signature));
}

async function seal(value: unknown, secret: string): Promise<string> {
  const payload = base64UrlJson(value);
  return `${payload}.${await sign(payload, secret)}`;
}

async function unseal<T>(token: string, secret: string): Promise<T | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!constantTimeEqual(await sign(payload, secret), signature)) return null;
  return parseBase64UrlJson<T>(payload);
}

function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

function parseCookie(
  header: string | null | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName !== name) continue;
    const value = rest.join("=");
    try {
      return decodeURIComponent(value);
    } catch {
      return value || null;
    }
  }
  return null;
}

function cookieHeader(
  request: Request,
  name: string,
  value: string,
  maxAge: number,
  path: string,
): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${
    encodeURIComponent(value)
  }; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearCookie(request: Request, name: string, path: string): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/gui";
  }
  if (value === "/") return "/gui";
  return value.startsWith("/gui") ? value : "/gui";
}

function callbackUrl(request: Request, env: AppRuntimeEnv): string {
  const config = authConfig(env);
  if (config.redirectUri) return config.redirectUri;
  return new URL(DEFAULT_CALLBACK_PATH, appBaseUrl(request, env)).toString();
}

async function discoverOidc(
  config: OidcConfig,
): Promise<OidcDiscoveryDocument> {
  if (!config.issuer) return {};
  const response = await fetch(
    `${config.issuer}/.well-known/openid-configuration`,
    { headers: { Accept: "application/json" } },
  ).catch(() => null);
  if (!response || !response.ok) return {};
  const body = await response.json().catch(() => null) as
    | OidcDiscoveryDocument
    | null;
  if (!body || typeof body !== "object") return {};
  if (
    typeof body.issuer === "string" &&
    normalizeIssuer(body.issuer) !== config.issuer
  ) {
    throw new Error("OIDC discovery issuer mismatch");
  }
  return body;
}

async function oidcEndpoints(config: OidcConfig) {
  const issuer = config.issuer!;
  const discovery = await discoverOidc(config);
  return {
    authorizationEndpoint: config.authorizationEndpoint ??
      discovery.authorization_endpoint ?? `${issuer}/oauth/authorize`,
    tokenEndpoint: config.tokenEndpoint ?? discovery.token_endpoint ??
      `${issuer}/oauth/token`,
    userinfoEndpoint: config.userinfoEndpoint ?? discovery.userinfo_endpoint ??
      `${issuer}/oauth/userinfo`,
    jwksUri: config.jwksUri ?? discovery.jwks_uri ?? `${issuer}/oauth/jwks`,
  };
}

async function exchangeCode(
  env: AppRuntimeEnv,
  request: Request,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const config = authConfig(env);
  const endpoints = await oidcEndpoints(config);
  const response = await fetch(endpoints.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
      redirect_uri: callbackUrl(request, env),
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: ${response.status}`);
  }
  const body = await response.json() as TokenResponse;
  if (!body.access_token || !body.id_token) {
    throw new Error("OAuth token response missing access_token or id_token");
  }
  return body;
}

async function fetchUserInfo(
  env: AppRuntimeEnv,
  accessToken: string,
): Promise<{ sub: string; name?: string }> {
  const config = authConfig(env);
  const endpoints = await oidcEndpoints(config);
  const response = await fetch(endpoints.userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`OAuth userinfo failed: ${response.status}`);
  }
  const body = await response.json() as UserInfoResponse;
  const sub = body.user?.id ?? body.sub;
  if (!sub) throw new Error("OAuth userinfo response missing subject");
  return { sub, name: body.user?.name ?? body.name };
}

function jwtSigningInput(parts: string[]): Uint8Array {
  return new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
}

async function verifyJwtSignature(
  input: {
    alg: string;
    jwk: JsonWebKey;
    signingInput: Uint8Array;
    signature: Uint8Array;
  },
): Promise<boolean> {
  const signature = new Uint8Array(input.signature);
  const signingInput = new Uint8Array(input.signingInput);
  if (input.alg === "ES256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      input.jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      signingInput,
    );
  }
  if (input.alg === "RS256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      input.jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      signature,
      signingInput,
    );
  }
  return false;
}

function selectJwk(
  jwks: { keys?: JsonWebKey[] },
  header: Record<string, unknown>,
): JsonWebKey | null {
  const alg = typeof header.alg === "string" ? header.alg : undefined;
  const kid = typeof header.kid === "string" ? header.kid : undefined;
  return (jwks.keys ?? []).find((key) => {
    if (key.use && key.use !== "sig") return false;
    if (alg && key.alg && key.alg !== alg) return false;
    if (kid && (key as JsonWebKey & { kid?: string }).kid !== kid) {
      return false;
    }
    return true;
  }) ?? null;
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberClaim(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function validateIdTokenClaims(
  claims: IdTokenClaims,
  config: OidcConfig,
  nonce: string,
): void {
  const now = Math.floor(Date.now() / 1000);
  if (stringClaim(claims.iss) !== config.issuer) {
    throw new Error("ID token issuer mismatch");
  }
  if (!stringClaim(claims.sub)) {
    throw new Error("ID token missing subject");
  }

  const audience = claims.aud;
  const audienceMatches = typeof audience === "string"
    ? audience === config.clientId
    : Array.isArray(audience) && audience.includes(config.clientId);
  if (!audienceMatches) throw new Error("ID token audience mismatch");
  if (Array.isArray(audience) && audience.length > 1) {
    if (stringClaim(claims.azp) !== config.clientId) {
      throw new Error("ID token authorized party mismatch");
    }
  } else if (
    claims.azp !== undefined && stringClaim(claims.azp) !== config.clientId
  ) {
    throw new Error("ID token authorized party mismatch");
  }

  const exp = numberClaim(claims.exp);
  if (!exp || exp <= now - CLOCK_SKEW_SECONDS) {
    throw new Error("ID token expired");
  }
  const nbf = numberClaim(claims.nbf);
  if (nbf && nbf > now + CLOCK_SKEW_SECONDS) {
    throw new Error("ID token not yet valid");
  }
  const iat = numberClaim(claims.iat);
  if (iat && iat > now + CLOCK_SKEW_SECONDS) {
    throw new Error("ID token issued in the future");
  }
  if (stringClaim(claims.nonce) !== nonce) {
    throw new Error("ID token nonce mismatch");
  }
}

async function verifyIdToken(
  env: AppRuntimeEnv,
  idToken: string,
  nonce: string,
): Promise<IdTokenClaims> {
  const config = authConfig(env);
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid ID token format");
  const header = parseBase64UrlJson<Record<string, unknown>>(parts[0]);
  const claims = parseBase64UrlJson<IdTokenClaims>(parts[1]);
  const signature = base64UrlBytes(parts[2]);
  if (!header || !claims || !signature) throw new Error("Invalid ID token");
  const alg = typeof header.alg === "string" ? header.alg : "";
  if (!["ES256", "RS256"].includes(alg)) {
    throw new Error("Unsupported ID token algorithm");
  }
  const endpoints = await oidcEndpoints(config);
  const jwksResponse = await fetch(endpoints.jwksUri, {
    headers: { Accept: "application/json" },
  });
  if (!jwksResponse.ok) {
    throw new Error(`OIDC JWKS fetch failed: ${jwksResponse.status}`);
  }
  const jwks = await jwksResponse.json() as { keys?: JsonWebKey[] };
  const jwk = selectJwk(jwks, header);
  if (!jwk) throw new Error("ID token signing key not found");
  const valid = await verifyJwtSignature({
    alg,
    jwk,
    signingInput: jwtSigningInput(parts),
    signature,
  });
  if (!valid) throw new Error("ID token signature invalid");
  validateIdTokenClaims(claims, config, nonce);
  return claims;
}

async function createSessionCookie(
  env: AppRuntimeEnv,
  request: Request,
  session: Omit<GuiSession, "exp">,
): Promise<string> {
  const secret = envValue(env, "APP_SESSION_SECRET");
  if (!secret) throw new Error("APP_SESSION_SECRET is required");
  return cookieHeader(
    request,
    SESSION_COOKIE,
    await seal(
      {
        ...session,
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
      } satisfies GuiSession,
      secret,
    ),
    SESSION_MAX_AGE_SECONDS,
    "/gui",
  );
}

export async function readGuiSession(
  env: AppRuntimeEnv,
  request: Request,
): Promise<GuiSession | null> {
  const config = authConfig(env);
  if (!config.required || !config.sessionSecret) return null;
  const raw = parseCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!raw) return null;
  const session = await unseal<GuiSession>(raw, config.sessionSecret);
  if (!session || session.exp <= Math.floor(Date.now() / 1000)) return null;
  return session;
}

export async function requireGuiAppAuth(
  env: AppRuntimeEnv,
  request: Request,
): Promise<Response | null> {
  if (!guiAppAuthRequired(env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const misconfigured = appAuthMisconfigured(env);
  if (misconfigured) return misconfigured;
  const session = await readGuiSession(env, request);
  return session ? null : Response.json({ error: "Unauthorized" }, {
    status: 401,
  });
}

function loginRedirect(request: Request): Response {
  const url = new URL(request.url);
  const loginUrl = new URL(`${DEFAULT_AUTH_PATH}/login`, url.origin);
  loginUrl.searchParams.set(
    "return_to",
    safeReturnTo(`${url.pathname}${url.search}`),
  );
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      "Location": `${loginUrl.pathname}${loginUrl.search}`,
    },
  });
}

export async function requireGuiAppOrRedirect(
  env: AppRuntimeEnv,
  request: Request,
): Promise<Response | null> {
  const auth = await requireGuiAppAuth(env, request);
  if (!auth) return null;
  return auth.status === 401 ? loginRedirect(request) : auth;
}

function launchRedirectUri(request: Request, env: AppRuntimeEnv): string {
  const consumePath = envValue(env, "INSTALL_LAUNCH_CONSUME_PATH") ??
    DEFAULT_LAUNCH_PATH;
  const redirectUri = new URL(consumePath, appBaseUrl(request, env));
  const current = new URL(request.url);
  for (const [key, value] of current.searchParams.entries()) {
    if (key !== "launch_token") redirectUri.searchParams.append(key, value);
  }
  return redirectUri.toString();
}

function consumeUrl(env: AppRuntimeEnv): string {
  const accountsBaseUrl = normalizeIssuer(envValue(env, "ACCOUNTS_BASE_URL")!);
  const installationId = encodeURIComponent(
    envValue(env, "INSTALL_LAUNCH_INSTALLATION_ID")!,
  );
  return `${accountsBaseUrl}/v1/installations/${installationId}/launch-token/consume`;
}

async function consumeLaunchToken(
  env: AppRuntimeEnv,
  request: Request,
  token: string,
): Promise<{
  sub: string;
  accountId?: string;
  spaceId?: string;
  appId?: string;
  role?: string;
}> {
  const response = await fetch(consumeUrl(env), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      redirect_uri: launchRedirectUri(request, env),
    }),
  });
  if (!response.ok) {
    throw new Error(`Launch token consume failed: ${response.status}`);
  }
  const body = await response.json() as Record<string, unknown>;
  const sub = stringClaim(body.sub) ?? stringClaim(body.subject);
  if (body.consumed !== true || !sub) {
    throw new Error("Launch token consume response is invalid");
  }
  return {
    sub,
    accountId: stringClaim(body.account_id) ?? stringClaim(body.accountId),
    spaceId: stringClaim(body.space_id) ?? stringClaim(body.spaceId),
    appId: stringClaim(body.app_id) ?? stringClaim(body.appId),
    role: stringClaim(body.role),
  };
}

function redirectToLogin(returnTo: string): Response {
  const url = new URL(
    `${DEFAULT_AUTH_PATH}/login`,
    "https://takos-computer.local",
  );
  url.searchParams.set("return_to", safeReturnTo(returnTo));
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      "Location": `${url.pathname}${url.search}`,
    },
  });
}

export function registerGuiAuthRoutes(
  app: Hono<{ Bindings: SandboxHostEnv }>,
): void {
  app.get(`${DEFAULT_AUTH_PATH}/login`, async (c) => {
    const misconfigured = appAuthMisconfigured(c.env);
    if (misconfigured) return misconfigured;
    const config = authConfig(c.env);
    try {
      const endpoints = await oidcEndpoints(config);
      const codeVerifier = randomToken();
      const state: OAuthState = {
        state: randomToken(),
        nonce: randomToken(),
        codeVerifier,
        returnTo: safeReturnTo(c.req.query("return_to") ?? null),
        exp: Math.floor(Date.now() / 1000) + STATE_MAX_AGE_SECONDS,
      };
      const authUrl = new URL(endpoints.authorizationEndpoint);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", config.clientId!);
      authUrl.searchParams.set("redirect_uri", callbackUrl(c.req.raw, c.env));
      authUrl.searchParams.set("scope", "openid profile email");
      authUrl.searchParams.set("state", state.state);
      authUrl.searchParams.set("nonce", state.nonce);
      authUrl.searchParams.set(
        "code_challenge",
        await sha256Base64Url(codeVerifier),
      );
      authUrl.searchParams.set("code_challenge_method", "S256");
      return new Response(null, {
        status: 302,
        headers: {
          "Cache-Control": "no-store",
          "Location": authUrl.toString(),
          "Set-Cookie": cookieHeader(
            c.req.raw,
            STATE_COOKIE,
            await seal(state, config.sessionSecret!),
            STATE_MAX_AGE_SECONDS,
            DEFAULT_AUTH_PATH,
          ),
        },
      });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "OIDC login failed",
      }, { status: 503 });
    }
  });

  app.get(`${DEFAULT_AUTH_PATH}/callback`, async (c) => {
    const config = authConfig(c.env);
    const misconfigured = appAuthMisconfigured(c.env);
    if (misconfigured) return misconfigured;
    const code = c.req.query("code");
    const returnedState = c.req.query("state");
    const stateCookie = parseCookie(c.req.header("Cookie"), STATE_COOKIE);
    const state = stateCookie
      ? await unseal<OAuthState>(stateCookie, config.sessionSecret!)
      : null;
    if (
      !code || !returnedState || !state || state.state !== returnedState ||
      state.exp <= Math.floor(Date.now() / 1000)
    ) {
      return Response.json({ error: "Invalid OAuth state" }, { status: 400 });
    }

    try {
      const token = await exchangeCode(
        c.env,
        c.req.raw,
        code,
        state.codeVerifier,
      );
      const claims = await verifyIdToken(c.env, token.id_token!, state.nonce);
      const user = await fetchUserInfo(c.env, token.access_token!);
      const subject = stringClaim(claims.sub);
      if (!subject || user.sub !== subject) {
        throw new Error("OAuth userinfo subject mismatch");
      }
      const headers = new Headers({
        "Cache-Control": "no-store",
        "Location": state.returnTo,
      });
      headers.append(
        "Set-Cookie",
        clearCookie(c.req.raw, STATE_COOKIE, DEFAULT_AUTH_PATH),
      );
      headers.append(
        "Set-Cookie",
        await createSessionCookie(c.env, c.req.raw, {
          sub: subject,
          name: user.name ?? stringClaim(claims.name) ??
            stringClaim(claims.email),
          accountId: stringClaim(claims.takosumi?.account_id),
          spaceId: stringClaim(claims.takosumi?.space_id),
          appId: stringClaim(claims.takosumi?.app_id),
          role: stringClaim(claims.takosumi?.role),
        }),
      );
      return new Response(null, { status: 302, headers });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "OAuth callback failed",
      }, { status: 502 });
    }
  });

  app.get(`${DEFAULT_AUTH_PATH}/me`, async (c) => {
    const auth = await requireGuiAppAuth(c.env, c.req.raw);
    if (auth) return auth;
    const session = await readGuiSession(c.env, c.req.raw);
    return c.json({
      authenticated: true,
      subject: session?.sub,
      name: session?.name,
      accountId: session?.accountId,
      spaceId: session?.spaceId,
      appId: session?.appId,
      role: session?.role,
    });
  });

  app.post(`${DEFAULT_AUTH_PATH}/logout`, (c) => {
    return Response.json({ success: true }, {
      headers: {
        "Set-Cookie": clearCookie(c.req.raw, SESSION_COOKIE, "/gui"),
      },
    });
  });

  app.get(DEFAULT_LAUNCH_PATH, async (c) => {
    const misconfigured = launchMisconfigured(c.env);
    if (misconfigured) return misconfigured;
    const token = c.req.query("launch_token")?.trim();
    const returnTo = safeReturnTo(c.req.query("return_to") ?? null);
    if (!token) {
      return Response.json({ error: "launch_token is required" }, {
        status: 400,
      });
    }
    try {
      const consumed = await consumeLaunchToken(c.env, c.req.raw, token);
      return new Response(null, {
        status: 302,
        headers: {
          "Cache-Control": "no-store",
          "Location": returnTo,
          "Set-Cookie": await createSessionCookie(c.env, c.req.raw, {
            sub: consumed.sub,
            accountId: consumed.accountId,
            spaceId: consumed.spaceId,
            appId: consumed.appId,
            role: consumed.role,
          }),
        },
      });
    } catch {
      return redirectToLogin(returnTo);
    }
  });
}
