// DIVERGENT COPY: takos-apps/takos-computer/packages/computer-hosts/src/app-auth.ts
//
// This file started from the canonical takos-app app-auth.ts that is
// byte-identical across takos-docs / takos-slide / takos-excel (see
// `takos-apps/takos-docs/src/app-auth.ts`), but it has intentionally
// diverged because takos-computer's GUI runs on a different surface and
// against the Takosumi Accounts launch-token flow. Do NOT try to re-sync
// this file with the canonical copy or include it in the
// `check:takos-apps-dedupe` check — the divergence is structural, not drift.
//
// Material differences from the canonical takos-app file:
//
//   1. Mount path: cookies and routes live under `/gui` instead of `/`.
//      Cookie names are `takos_computer_*` rather than `takos_app_*`.
//   2. Env-var prefix: OIDC discovery uses `OIDC_*` (issuer / authorization /
//      token / userinfo / JWKS / client / redirect) instead of the canonical
//      `OAUTH_*`. The set of required env vars is also larger because OIDC
//      discovery, JWKS signing, and the launch-token flow are all wired up.
//   3. ID token verification: the canonical copy trusts the access_token and
//      calls /userinfo. This copy performs full RFC 7519 / OIDC ID token
//      verification: JWKS fetch, ES256 / RS256 signature verification with
//      clock-skew, issuer / audience / azp / nonce / nbf / iat checks, and a
//      consistency check between userinfo.sub and id_token.sub.
//   4. Discovery: this copy reads `.well-known/openid-configuration` to
//      resolve authorization / token / userinfo / JWKS endpoints (with env
//      overrides). The canonical copy hardcodes `${issuer}/oauth/*` paths.
//   5. PKCE + nonce: this copy adds an OIDC nonce alongside PKCE; the
//      canonical copy uses PKCE only.
//   6. Session payload: this copy carries Takosumi claims (account_id /
//      space_id / app_id / role) in addition to sub / name. The canonical
//      copy only carries sub / name.
//   7. Launch-token flow: this copy exposes `/gui/api/auth/launch`, which
//      consumes a single-use Takosumi Accounts launch token by POSTing to
//      `ACCOUNTS_BASE_URL/v1/installations/<id>/launch-token/consume` and
//      mints a GUI session directly (no OAuth redirect round-trip). The
//      canonical copy has no launch-token concept.
//   8. Function surface: this copy exports `guiAppAuthRequired`,
//      `requireGuiAppAuth`, `requireGuiAppOrRedirect`, `readGuiSession`, and
//      `registerGuiAuthRoutes` (named for the GUI scope, with a redirect
//      variant for browser navigation). The canonical copy exports
//      `requireAppAuth` and `registerAuthRoutes` (no redirect variant).
//   9. Cookie parsing is URL-decoded (canonical is naive). Signature
//      comparison uses `constantTimeEqual` (canonical uses `!==`).
//
// If shared OIDC primitives are ever extracted into a separately published
// package, this file should be the consumer that drives the contract: it is
// the more complete implementation. Until that package exists, importing
// from the canonical copy is not viable because the divergence is in the
// public surface (function names, return-type semantics, env var prefixes),
// not just internal helpers.
import type { Hono } from "hono";
import {
  base64Url,
  constantTimeEqual,
  randomBase64UrlToken,
} from "@takos-computer/common/crypto";
import {
  normalizeIssuer,
  type OidcConfig,
  oidcEndpoints,
  parseBase64UrlJson,
  stringClaim,
  type TokenResponse,
  type UserInfoResponse,
  verifyIdToken,
} from "./oidc-verify.ts";
import type { SandboxHostEnv } from "./sandbox-session-types.ts";

const SESSION_COOKIE = "takos_computer_session";
const STATE_COOKIE = "takos_computer_oauth_state";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const STATE_MAX_AGE_SECONDS = 10 * 60;
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

function envValue(env: AppRuntimeEnv, name: string): string | undefined {
  const value = env[name as keyof AppRuntimeEnv];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function flagEnabled(env: AppRuntimeEnv, name: string): boolean {
  const value = envValue(env, name);
  return value ? ["1", "true", "yes"].includes(value.toLowerCase()) : false;
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

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
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

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

export function parseCookie(
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
      const codeVerifier = randomBase64UrlToken();
      const state: OAuthState = {
        state: randomBase64UrlToken(),
        nonce: randomBase64UrlToken(),
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
      const claims = await verifyIdToken(config, token.id_token!, state.nonce);
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
