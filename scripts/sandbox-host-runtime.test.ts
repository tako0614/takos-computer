import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Miniflare } from "miniflare";
import {
  createWranglerConfig,
  parseOpenTofuDeployConfig,
} from "./opentofu-deploy.ts";

test("the root module Worker runs at its declared compatibility date", async () => {
  const repoRoot = resolve(import.meta.dir, "..");
  const main = await readFile(join(repoRoot, "main.tf"), "utf8");
  const dates = [...main.matchAll(/\bcompatibilityDate\s*=\s*"(\d{4}-\d{2}-\d{2})"/gu)];
  expect(dates).toHaveLength(1);
  const compatibilityDate = dates[0]![1]!;
  const directory = await mkdtemp(join(tmpdir(), "computer-root-runtime-"));
  await chmod(directory, 0o700);
  let runtime: Miniflare | undefined;
  let outboundCalls = 0;
  try {
    const artifact = join(directory, "worker.js");
    const child = Bun.spawn([
      process.execPath,
      join(repoRoot, "packages/computer-hosts/scripts/build-host.ts"),
      "sandbox", "--outfile", artifact,
    ], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`Worker build failed: ${stdout}\n${stderr}`);
    await chmod(artifact, 0o600);
    const config = createWranglerConfig(parseOpenTofuDeployConfig(JSON.stringify({
      accountId: "a".repeat(32),
      workerName: "computer-root-runtime-test",
      publicOrigin: "https://computer-root-runtime.example.test",
      workersDev: false,
      sessionIndexId: "b".repeat(32),
      containerImage: `example.test/sandbox@sha256:${"c".repeat(64)}`,
      containerMax: 1,
      compatibilityDate,
      sourceDigest: "d".repeat(64),
      accountsIssuer: "https://accounts.example.test",
      workspaceId: "",
      capsuleId: "cap_runtime_test",
      appOidc: false,
      allowPublicSandboxCreation: false,
      oidcClientId: "",
      oidcRedirectUri: "https://computer-root-runtime.example.test/gui/api/auth/callback",
      takosApiUrl: "",
      maxUserSessions: 1,
    })), { repoRoot, configDirectory: directory });
    expect(config.compatibility_date).toBe(compatibilityDate);
    runtime = new Miniflare({
      modules: [{ type: "ESModule", path: artifact }],
      modulesRoot: directory,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      cf: false,
      bindings: { SANDBOX_HOST_AUTH_TOKEN: "synthetic-runtime-test-token" },
      outboundService() {
        outboundCalls++;
        throw new Error("Unexpected external HTTP from local runtime regression");
      },
    });
    await runtime.ready;
    const anonymous = await runtime.dispatchFetch("http://runtime.test/create", {
      method: "POST", body: "{}",
    });
    expect(anonymous.status).toBe(401);
    const headers = {
      Authorization: "Bearer synthetic-runtime-test-token",
      "Content-Type": "application/json",
    };
    for (const path of ["/create", "/gui/api/sandbox-create"]) {
      const oversized = await runtime.dispatchFetch(`http://runtime.test${path}`, {
        method: "POST", headers,
        body: JSON.stringify({ padding: "x".repeat(16 * 1024) }),
      });
      expect(oversized.status).toBe(413);
      expect(await oversized.json()).toEqual({
        error: "Session creation request body too large",
      });
      const invalid = await runtime.dispatchFetch(`http://runtime.test${path}`, {
        method: "POST", headers, body: "{",
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "Invalid JSON body" });
    }
    expect(outboundCalls).toBe(0);
  } finally {
    try {
      await runtime?.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
