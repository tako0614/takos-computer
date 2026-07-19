import { describe, expect, test } from "bun:test";
import {
  createWranglerConfig,
  deploymentSecrets,
  parseOpenTofuDeployConfig,
} from "./opentofu-deploy.ts";

const valid = {
  accountId: "a".repeat(32),
  workerName: "takos-computer-test",
  publicOrigin: "https://computer.example.test",
  workersDev: false,
  sessionIndexId: "b".repeat(32),
  containerImage: "",
  containerMax: 12,
  compatibilityDate: "2026-07-19",
  sourceDigest: "c".repeat(64),
  accountsIssuer: "https://accounts.example.test",
  workspaceId: "ws_test",
  capsuleId: "cap_test",
  appOidc: true,
  oidcClientId: "client_test",
  oidcRedirectUri: "https://computer.example.test/gui/api/auth/callback",
  takosApiUrl: "https://takos.example.test/api",
  maxUserSessions: 8,
};

describe("OpenTofu deploy configuration", () => {
  test("parses the closed shape and renders an official Wrangler Container deployment", () => {
    const parsed = parseOpenTofuDeployConfig(JSON.stringify(valid));
    const config = createWranglerConfig(parsed, {
      repoRoot: "/repo",
      configDirectory: "/repo/.wrangler/opentofu/test",
    });

    expect(config.name).toBe("takos-computer-test");
    expect(config.containers).toEqual([
      {
        class_name: "SandboxSessionContainer",
        image: "../../../apps/sandbox/Dockerfile",
        image_build_context: "../../..",
        instance_type: "basic",
        max_instances: 12,
      },
    ]);
    expect(config.durable_objects).toEqual({
      bindings: [
        {
          name: "SANDBOX_CONTAINER",
          class_name: "SandboxSessionContainer",
        },
      ],
    });
    expect(config.vars).toMatchObject({
      MCP_URL: "https://computer.example.test/mcp",
      OIDC_ISSUER_URL: "https://accounts.example.test",
      APP_WORKSPACE_ID: "ws_test",
      APP_CAPSULE_ID: "cap_test",
      APP_AUTH_REQUIRED: "1",
    });
    expect(JSON.stringify(config)).not.toContain("secret");
  });

  test("rejects unknown fields and partial Interface OAuth ownership", () => {
    expect(() =>
      parseOpenTofuDeployConfig(JSON.stringify({ ...valid, unexpected: true })),
    ).toThrow("closed deployment-config shape");
    expect(() =>
      parseOpenTofuDeployConfig(JSON.stringify({ ...valid, capsuleId: "" })),
    ).toThrow("workspaceId and capsuleId");
  });

  test("keeps secrets out of config and requires the two runtime-internal bearers", () => {
    expect(
      deploymentSecrets({
        SANDBOX_HOST_AUTH_TOKEN: "host",
        MCP_AUTH_TOKEN: "container",
        PUBLISHED_MCP_AUTH_TOKEN: "direct",
        APP_SESSION_SECRET: "session",
        OIDC_CLIENT_SECRET: "oidc",
      }),
    ).toEqual({
      SANDBOX_HOST_AUTH_TOKEN: "host",
      MCP_AUTH_TOKEN: "container",
      PUBLISHED_MCP_AUTH_TOKEN: "direct",
      APP_SESSION_SECRET: "session",
      OIDC_CLIENT_SECRET: "oidc",
    });
    expect(() => deploymentSecrets({ MCP_AUTH_TOKEN: "container" })).toThrow(
      "SANDBOX_HOST_AUTH_TOKEN",
    );
  });
});
