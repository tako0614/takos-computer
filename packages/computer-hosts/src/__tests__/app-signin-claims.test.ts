import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { readGuiSession, registerGuiAuthRoutes, requireGuiAppAuth } from "../app-auth.ts";
import { resolveAppSignInClaims } from "../app-signin-claims.ts";
import { guiSessionOwnsSandbox } from "../sandbox-host-auth.ts";
import type { SandboxHostEnv } from "../sandbox-session-types.ts";

describe("per-app sign-in claims", () => {
  for (const appRole of ["owner", "member"] as const) {
    test(`accepts the matching Capsule ${appRole}`, () => {
      expect(resolveAppSignInClaims({ capsule_id: "cap_test", app_role: appRole }, "cap_test"))
        .toEqual({ capsuleId: "cap_test", appRole });
    });
  }

  test("accepts ordinary users and preserves claim-absent compatibility", () => {
    expect(resolveAppSignInClaims({ capsule_id: "cap_test" }, "cap_test"))
      .toEqual({ capsuleId: "cap_test" });
    expect(resolveAppSignInClaims({ workspace_id: "ws_test", role: "owner" }, "cap_test"))
      .toEqual({});
    expect(resolveAppSignInClaims(undefined, undefined)).toEqual({});
  });

  test("rejects foreign or unconfigured Capsules, even with legacy owner claims", () => {
    for (const expectedCapsuleId of ["cap_other", undefined, ""]) {
      expect(() => resolveAppSignInClaims({
        capsule_id: "cap_test", app_role: "owner", workspace_id: "ws_test", role: "owner",
      }, expectedCapsuleId)).toThrow("Capsule mismatch");
    }
  });

  test("rejects explicit malformed roles and incomplete app claims", () => {
    for (const appRole of ["admin", "", null, false, 1, ["owner"], {}]) {
      expect(() => resolveAppSignInClaims({ capsule_id: "cap_test", app_role: appRole }, "cap_test"))
        .toThrow("Invalid app role");
    }
    for (const capsuleId of [undefined, null, "", 1, ["cap_test"]]) {
      expect(() => resolveAppSignInClaims({ capsule_id: capsuleId, app_role: "owner" }, "cap_test"))
        .toThrow("Capsule mismatch");
    }
  });

  test("rejects explicitly malformed Takosumi claim envelopes", () => {
    for (const evidence of [null, false, "malformed", 1, []]) {
      expect(() => resolveAppSignInClaims(evidence, "cap_test"))
        .toThrow("Invalid Takosumi sign-in claims");
    }
  });
});

async function signedCookie(name: string, value: Record<string, unknown>): Promise<string> {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode("test-session-secret"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = Buffer.from(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(payload),
  )).toString("base64url");
  return `${name}=${payload}.${signature}`;
}

async function signedSessionRequest(session: Record<string, unknown>): Promise<Request> {
  return new Request("https://computer.example.test/gui/api/auth/me", {
    headers: {
      Cookie: await signedCookie("takos_computer_session", {
        sub: "user-1", exp: Math.floor(Date.now() / 1000) + 300, ...session,
      }),
    },
  });
}

const env = {
  APP_AUTH_REQUIRED: "1", APP_SESSION_SECRET: "test-session-secret",
  OIDC_ISSUER_URL: "https://accounts.example.test", OIDC_CLIENT_ID: "test-client",
  APP_CAPSULE_ID: "cap_test",
} as SandboxHostEnv;

test("session reads recheck the current Capsule binding", async () => {
  const request = await signedSessionRequest({ capsuleId: "cap_test", appRole: "member" });
  expect((await readGuiSession(env, request))?.appRole).toBe("member");
  expect(await requireGuiAppAuth(env, request)).toBeNull();
  expect(await readGuiSession({ ...env, APP_CAPSULE_ID: "cap_changed" }, request)).toBeNull();
  expect((await requireGuiAppAuth({ ...env, APP_CAPSULE_ID: "cap_changed" }, request))?.status)
    .toBe(401);
});

test("role-less app and legacy sessions remain ordinary users", async () => {
  for (const claims of [{ capsuleId: "cap_test" }, { role: "owner", spaceId: "space-1" }]) {
    const request = await signedSessionRequest(claims);
    expect(await requireGuiAppAuth(env, request)).toBeNull();
    expect((await readGuiSession(env, request))?.appRole).toBeUndefined();
  }
});

test("session rechecks reject malformed explicit app roles", async () => {
  const request = await signedSessionRequest({ capsuleId: "cap_test", appRole: "admin" });
  expect(await readGuiSession(env, request)).toBeNull();
});

test("app management roles keep the existing sandbox ownership boundary", () => {
  for (const appRole of ["owner", "member"] as const) {
    const session = { sub: "user-1", capsuleId: "cap_test", appRole, exp: 1 };
    const ownSandbox = { sessionId: "session-1", userId: "user-1", spaceId: "" };
    expect(guiSessionOwnsSandbox(session, ownSandbox)).toBe(true);
    expect(guiSessionOwnsSandbox(session, { ...ownSandbox, userId: "other-user" }))
      .toBe(false);
    expect(guiSessionOwnsSandbox(session, { ...ownSandbox, sessionId: "pmcp-session-1" }))
      .toBe(false);
  }
});

test("verified OIDC callbacks expose app management only for the matching owner/member", async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const callbackEnv = {
    ...env,
    OIDC_AUTHORIZATION_URL: "https://accounts.example.test/authorize",
    OIDC_TOKEN_URL: "https://accounts.example.test/token",
    OIDC_USERINFO_URL: "https://accounts.example.test/userinfo",
    OIDC_JWKS_URL: "https://accounts.example.test/app-signin-test-jwks",
  };
  const app = new Hono<{ Bindings: SandboxHostEnv }>();
  registerGuiAuthRoutes(app);
  let evidence: unknown = {};
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (request: RequestInfo | URL) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      if (url.pathname === "/token") {
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "app-signin" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({
          iss: env.OIDC_ISSUER_URL, sub: "user-1", aud: env.OIDC_CLIENT_ID,
          nonce: "test-nonce", iat: now, exp: now + 300, takosumi: evidence,
        })).toString("base64url");
        const input = `${header}.${payload}`;
        const signature = Buffer.from(await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, new TextEncoder().encode(input),
        )).toString("base64url");
        return Response.json({ access_token: "test-access", id_token: `${input}.${signature}` });
      }
      if (url.pathname === "/app-signin-test-jwks") {
        return Response.json({ keys: [{ ...publicJwk, kid: "app-signin", alg: "ES256", use: "sig" }] });
      }
      if (url.pathname === "/userinfo") return Response.json({ sub: "user-1" });
      throw new Error(`Unexpected test endpoint: ${url.pathname}`);
    },
  });
  try {
    for (const claims of [
      { capsule_id: "cap_test", app_role: "owner" },
      { capsule_id: "cap_test", app_role: "member" },
      { capsule_id: "cap_test" },
      { workspace_id: "ws_test", role: "owner" },
      { capsule_id: "cap_other", app_role: "owner" },
      { capsule_id: "cap_test", app_role: "admin" },
      null, false, "malformed", [],
    ]) {
      evidence = claims;
      const stateCookie = await signedCookie("takos_computer_oauth_state", {
        state: "test-state", nonce: "test-nonce", codeVerifier: "verifier",
        returnTo: "/gui", exp: Math.floor(Date.now() / 1000) + 300,
      });
      const callback = await app.request("https://computer.example.test/gui/api/auth/callback?code=test-code&state=test-state", {
        headers: { Cookie: stateCookie },
      }, callbackEnv);
      if (
        !claims || typeof claims !== "object" || Array.isArray(claims) ||
        claims.capsule_id === "cap_other" || claims.app_role === "admin"
      ) {
        expect(callback.status).toBe(502);
        expect(callback.headers.get("set-cookie")).toBeNull();
        continue;
      }
      expect(callback.status).toBe(302);
      const sessionCookie = callback.headers.getSetCookie()
        .find((cookie) => cookie.startsWith("takos_computer_session="))!;
      const me = await app.request("https://computer.example.test/gui/api/auth/me", {
        headers: { Cookie: sessionCookie.split(";")[0] },
      }, callbackEnv);
      expect(me.status).toBe(200);
      const body = await me.json() as Record<string, unknown>;
      expect(body.capsuleId).toBe(claims.capsule_id);
      expect(body.appRole).toBe(claims.app_role);
      expect(body.canManageApp).toBe(claims.app_role === "owner" || claims.app_role === "member");
    }
  } finally {
    Object.defineProperty(globalThis, "fetch", { value: originalFetch, configurable: true });
  }
});
