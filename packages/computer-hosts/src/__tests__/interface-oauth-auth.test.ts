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
  test("accepts exact mcp.invoke audience and owner evidence", async () => {
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
