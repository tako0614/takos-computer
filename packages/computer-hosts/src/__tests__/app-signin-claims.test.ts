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
    expect(resolveAppSignInClaims({ capsule_id: "cap_test" }, "cap_test", "ws_test", []))
      .toEqual({ capsuleId: "cap_test" });
  });

  test("accepts the current Accounts shape through matching legacy membership", () => {
    for (const role of ["owner", "admin", "member", "viewer"]) {
      expect(resolveAppSignInClaims({
        capsule_id: "cap_test", workspace_id: "ws_test", role,
      }, "cap_test", "ws_test", ["ws_test"]))
        .toEqual({
          capsuleId: "cap_test", appRole: role === "owner" ? "owner" : "member",
          legacyWorkspaceId: "ws_test",
        });
    }
  });

  test("supports configured legacy Workspace sign-in without a Capsule binding", () => {
    expect(resolveAppSignInClaims({
      capsule_id: "cap_test", workspace_id: "ws_test", role: "member",
    }, undefined, "ws_test", ["ws_test"]))
      .toEqual({ appRole: "member", legacyWorkspaceId: "ws_test" });
    expect(resolveAppSignInClaims({ capsule_id: "cap_test" }, undefined))
      .toEqual({});
    expect(resolveAppSignInClaims(undefined, undefined, "ws_test", ["ws_test"]))
      .toEqual({ appRole: "member", legacyWorkspaceId: "ws_test" });
    expect(resolveAppSignInClaims({ role: "owner" }, undefined, "ws_test", ["ws_test"]))
      .toEqual({ appRole: "member", legacyWorkspaceId: "ws_test" });
  });

  test("matching Capsule alone cannot turn flat Workspace membership into app authority", () => {
    for (const claims of [{ capsule_id: "cap_test" }, { capsule_id: "cap_test", role: "owner" }]) {
      expect(resolveAppSignInClaims(claims, "cap_test", "ws_test", ["ws_test"]))
        .toEqual({ capsuleId: "cap_test" });
    }
  });

  test("legacy fallback rejects mismatched or malformed evidence", () => {
    for (const [claims, memberships] of [
      [{ capsule_id: "cap_other", workspace_id: "ws_test", role: "owner" }, ["ws_test"]],
      [{ capsule_id: "cap_test", workspace_id: "ws_other", role: "owner" }, ["ws_test"]],
      [{ capsule_id: "cap_test", workspace_id: "ws_test", role: "administer" }, ["ws_test"]],
      [{ capsule_id: "cap_test", workspace_id: "ws_test", role: "member" }, ["ws_other"]],
      [{ capsule_id: "cap_test", workspace_id: "ws_test", role: "member" }, ["ws_test", 1]],
      [{ capsule_id: "cap_test", workspace_id: "ws_test", role: "member" }, null],
      [{ capsule_id: "cap_test", workspace_id: "ws_test", app_role: "admin" }, ["ws_test"]],
    ]) {
      expect(() => resolveAppSignInClaims(claims, "cap_test", "ws_test", memberships))
        .toThrow();
    }
    for (const role of [null, false, 1, ["owner"], {}]) {
      expect(() => resolveAppSignInClaims({ workspace_id: "ws_test", role }, "cap_test", "ws_test"))
        .toThrow("Invalid legacy Workspace role");
    }
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

test("legacy membership sessions recheck the configured Workspace", async () => {
  const request = await signedSessionRequest({
    capsuleId: "cap_test", appRole: "member", legacyWorkspaceId: "ws_test",
  });
  expect((await readGuiSession({ ...env, APP_WORKSPACE_ID: "ws_test" }, request))?.appRole)
    .toBe("member");
  expect(await readGuiSession({ ...env, APP_WORKSPACE_ID: "ws_other" }, request)).toBeNull();
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
    APP_WORKSPACE_ID: "ws_test",
    OIDC_AUTHORIZATION_URL: "https://accounts.example.test/authorize",
    OIDC_TOKEN_URL: "https://accounts.example.test/token",
    OIDC_USERINFO_URL: "https://accounts.example.test/userinfo",
    OIDC_JWKS_URL: "https://accounts.example.test/app-signin-test-jwks",
  };
  const app = new Hono<{ Bindings: SandboxHostEnv }>();
  registerGuiAuthRoutes(app);
  let evidence: unknown = {};
  let workspaceMemberships: unknown;
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
          workspace_memberships: workspaceMemberships,
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
    const cases: Array<{
      claims: unknown;
      memberships?: unknown;
      legacy?: boolean;
      expected?: { capsuleId?: string; appRole?: string; legacyWorkspaceId?: string };
    }> = [
      { claims: { capsule_id: "cap_test", app_role: "owner" }, expected: { capsuleId: "cap_test", appRole: "owner" } },
      { claims: { capsule_id: "cap_test", app_role: "member" }, expected: { capsuleId: "cap_test", appRole: "member" } },
      { claims: { capsule_id: "cap_test" }, expected: { capsuleId: "cap_test" } },
      { claims: { capsule_id: "cap_test" }, memberships: [], expected: { capsuleId: "cap_test" } },
      { claims: { capsule_id: "cap_test" }, memberships: ["ws_test"], expected: { capsuleId: "cap_test" } },
      { claims: { capsule_id: "cap_test", role: "owner" }, memberships: ["ws_test"], expected: { capsuleId: "cap_test" } },
      { claims: { workspace_id: "ws_test", role: "owner" }, expected: { appRole: "owner", legacyWorkspaceId: "ws_test" } },
      ...["owner", "admin", "member", "viewer"].flatMap((role) => [false, true].map((legacy) => ({
        // Exact current Accounts wire shape: no app_role anywhere.
        claims: { capsule_id: "cap_test", workspace_id: "ws_test", role },
        memberships: ["ws_test"], legacy,
        expected: {
          ...(legacy ? {} : { capsuleId: "cap_test" }),
          appRole: role === "owner" ? "owner" : "member", legacyWorkspaceId: "ws_test",
        },
      }))),
      { claims: { capsule_id: "cap_other", app_role: "owner" } },
      { claims: { capsule_id: "cap_test", app_role: "admin" } },
      { claims: { capsule_id: "cap_other", workspace_id: "ws_test", role: "owner" }, memberships: ["ws_test"] },
      { claims: { capsule_id: "cap_test", workspace_id: "ws_other", role: "owner" }, memberships: ["ws_test"] },
      { claims: { capsule_id: "cap_test", workspace_id: "ws_test", role: "invalid" }, memberships: ["ws_test"] },
      { claims: { capsule_id: "cap_test", workspace_id: "ws_test", role: "member" }, memberships: ["ws_other"] },
      ...[null, false, "malformed", []].map((claims) => ({ claims })),
    ];
    for (const item of cases) {
      evidence = item.claims;
      workspaceMemberships = item.memberships;
      const runtimeEnv = { ...callbackEnv, APP_CAPSULE_ID: item.legacy ? undefined : "cap_test" };
      const stateCookie = await signedCookie("takos_computer_oauth_state", {
        state: "test-state", nonce: "test-nonce", codeVerifier: "verifier",
        returnTo: "/gui", exp: Math.floor(Date.now() / 1000) + 300,
      });
      const callback = await app.request("https://computer.example.test/gui/api/auth/callback?code=test-code&state=test-state", {
        headers: { Cookie: stateCookie },
      }, runtimeEnv);
      if (!item.expected) {
        expect(callback.status).toBe(502);
        expect(callback.headers.get("set-cookie")).toBeNull();
        continue;
      }
      expect(callback.status).toBe(302);
      const sessionCookie = callback.headers.getSetCookie()
        .find((cookie) => cookie.startsWith("takos_computer_session="))!;
      const me = await app.request("https://computer.example.test/gui/api/auth/me", {
        headers: { Cookie: sessionCookie.split(";")[0] },
      }, runtimeEnv);
      expect(me.status).toBe(200);
      const body = await me.json() as Record<string, unknown>;
      expect(body.capsuleId).toBe(item.expected.capsuleId);
      expect(body.appRole).toBe(item.expected.appRole);
      expect(body.canManageApp).toBe(Boolean(item.expected.appRole));
      const session = await readGuiSession(runtimeEnv, new Request("https://computer.example.test/gui", {
        headers: { Cookie: sessionCookie.split(";")[0] },
      }));
      expect(session?.legacyWorkspaceId).toBe(item.expected.legacyWorkspaceId);
    }
  } finally {
    Object.defineProperty(globalThis, "fetch", { value: originalFetch, configurable: true });
  }
});
