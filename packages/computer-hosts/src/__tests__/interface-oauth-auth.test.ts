import { describe, expect, test } from "bun:test";
import {
  authorizeInterfaceOAuthBearer,
  hasValidInterfaceOAuthConfiguration,
} from "../interface-oauth-auth.ts";

const audience = "https://computer.example.test/mcp";
const claims = {
  token_use: "interface_oauth",
  sub: "svc_agent",
  aud: audience,
  scope: "mcp.invoke",
  takosumi: {
    workspace_id: "ws_test",
    capsule_id: "cap_test",
    interface_id: "if_mcp",
    interface_binding_id: "ifb_agent",
    interface_resolved_revision: 3,
  },
};

function options(value: unknown = claims) {
  return {
    issuerUrl: "https://accounts.example.test",
    expectedAudience: audience,
    expectedWorkspaceId: "ws_test",
    expectedCapsuleId: "cap_test",
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://accounts.example.test/oauth/userinfo",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer taksrv_test",
      );
      return Response.json(value);
    },
  };
}

describe("Takos Computer Interface OAuth", () => {
  test("accepts Capsule-only machine evidence without an app role", async () => {
    const { workspace_id: _legacyWorkspace, ...appEvidence } = claims.takosumi;
    const appClaims = { ...claims, takosumi: appEvidence };
    for (const expectedWorkspaceId of [undefined, "ws_test"]) {
      const result = await authorizeInterfaceOAuthBearer(
        new Request(audience, { method: "POST" }),
        "taksrv_test",
        "mcp.invoke",
        { ...options(appClaims), expectedWorkspaceId },
      );
      expect(result).toMatchObject({
        subject: "svc_agent", capsuleId: "cap_test", permission: "mcp.invoke",
      });
      expect(result?.workspaceId).toBe(expectedWorkspaceId);
    }
  });

  test("validates optional workspace evidence without deriving app authority from it", async () => {
    const config = { ...options(), expectedWorkspaceId: undefined };
    expect(await authorizeInterfaceOAuthBearer(
      new Request(audience), "taksrv_test", "mcp.invoke", config,
    )).toMatchObject({ capsuleId: "cap_test" });
    for (const workspaceId of [null, "", "bad workspace", [], 7]) {
      expect(await authorizeInterfaceOAuthBearer(
        new Request(audience), "taksrv_test", "mcp.invoke", {
          ...options({ ...claims, takosumi: { ...claims.takosumi, workspace_id: workspaceId } }),
          expectedWorkspaceId: undefined,
        },
      )).toBeNull();
    }
  });

  test("Capsule-only grants still require exact app capability evidence", async () => {
    const { workspace_id: _legacyWorkspace, ...appEvidence } = claims.takosumi;
    for (const mutation of [
      { ...claims, token_use: "access_token", takosumi: appEvidence },
      { ...claims, aud: "https://foreign.example.test/mcp", takosumi: appEvidence },
      { ...claims, scope: "mcp.invoke mcp.admin", takosumi: appEvidence },
      ...[
        { capsule_id: undefined }, { capsule_id: "cap_other" },
        { interface_id: "" }, { interface_binding_id: "" },
        { interface_resolved_revision: 0 }, { interface_resolved_revision: 1.5 },
      ].map((evidence) => ({ ...claims, takosumi: { ...appEvidence, ...evidence } })),
    ]) {
      expect(await authorizeInterfaceOAuthBearer(
        new Request(audience), "taksrv_test", "mcp.invoke", {
          ...options(mutation), expectedWorkspaceId: undefined,
        },
      )).toBeNull();
    }
    expect(await authorizeInterfaceOAuthBearer(
      new Request(audience), "taksrv_test", "mcp.invoke", {
        ...options(), expectedCapsuleId: undefined, expectedWorkspaceId: undefined,
      },
    )).toBeNull();
  });

  test("accepts exact mcp.invoke audience and capability evidence", async () => {
    const result = await authorizeInterfaceOAuthBearer(
      new Request(audience, { method: "POST" }),
      "taksrv_test",
      "mcp.invoke",
      options(),
    );
    expect(result).toEqual({
      subject: "svc_agent",
      workspaceId: "ws_test",
      capsuleId: "cap_test",
      interfaceId: "if_mcp",
      interfaceBindingId: "ifb_agent",
      interfaceResolvedRevision: 3,
      audience,
      permission: "mcp.invoke",
    });
  });

  test("rejects scope, audience, owner, evidence, token, and request-target drift", async () => {
    for (const mutation of [
      { ...claims, scope: "mcp.read" },
      { ...claims, aud: "https://other.example.test/mcp" },
      {
        ...claims,
        takosumi: { ...claims.takosumi, workspace_id: "ws_other" },
      },
      {
        ...claims,
        takosumi: { ...claims.takosumi, interface_resolved_revision: 0 },
      },
    ]) {
      expect(
        await authorizeInterfaceOAuthBearer(
          new Request(audience, { method: "POST" }),
          "taksrv_test",
          "mcp.invoke",
          options(mutation),
        ),
      ).toBeNull();
    }
    expect(
      await authorizeInterfaceOAuthBearer(
        new Request(audience, { method: "POST" }),
        "direct-token",
        "mcp.invoke",
        options(),
      ),
    ).toBeNull();
    expect(
      await authorizeInterfaceOAuthBearer(
        new Request("https://computer.example.test/gui", { method: "POST" }),
        "taksrv_test",
        "mcp.invoke",
        options(),
      ),
    ).toBeNull();
  });

  test("configuration is fail-closed", () => {
    expect(hasValidInterfaceOAuthConfiguration({
      issuerUrl: "https://accounts.example.test", audience, capsuleId: "cap_test",
    })).toBe(true);
    expect(hasValidInterfaceOAuthConfiguration({
      issuerUrl: "https://accounts.example.test", audience,
      capsuleId: "cap_test", workspaceId: "bad workspace",
    })).toBe(false);
    expect(
      hasValidInterfaceOAuthConfiguration({
        issuerUrl: "https://accounts.example.test",
        audience,
        workspaceId: "ws_test",
        capsuleId: "cap_test",
      }),
    ).toBe(true);
    expect(
      hasValidInterfaceOAuthConfiguration({
        issuerUrl: "http://accounts.example.test",
        audience,
        workspaceId: "ws_test",
        capsuleId: "cap_test",
      }),
    ).toBe(false);
    expect(
      hasValidInterfaceOAuthConfiguration({
        issuerUrl: "https://accounts.example.test/not-an-origin",
        audience,
        workspaceId: "ws_test",
        capsuleId: "cap_test",
      }),
    ).toBe(false);
    expect(
      hasValidInterfaceOAuthConfiguration({
        issuerUrl: "https://accounts.example.test",
        audience,
        workspaceId: "ws_test",
      }),
    ).toBe(false);
  });
});
