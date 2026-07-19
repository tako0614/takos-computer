import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createWranglerConfig,
  parseOpenTofuDeployConfig,
} from "./opentofu-deploy.ts";

const repoRoot = resolve(import.meta.dir, "..");
const directory = await mkdtemp(
  join(tmpdir(), "takos-computer-wrangler-check-"),
);
await chmod(directory, 0o700);
try {
  const config = parseOpenTofuDeployConfig(
    JSON.stringify({
      accountId: "a".repeat(32),
      workerName: "takos-computer-check",
      publicOrigin: "https://takos-computer-check.example.workers.dev",
      workersDev: false,
      sessionIndexId: "b".repeat(32),
      // The deploy-config check validates the Wrangler schema without pulling or
      // running an app image. The Dockerfile itself is checked separately below.
      containerImage: "docker.io/oven/bun:1",
      containerMax: 2,
      compatibilityDate: "2026-07-19",
      sourceDigest: "c".repeat(64),
      accountsIssuer: "https://accounts.example.test",
      workspaceId: "ws_check",
      capsuleId: "cap_check",
      appOidc: false,
      oidcClientId: "",
      oidcRedirectUri:
        "https://takos-computer-check.example.workers.dev/gui/api/auth/callback",
      takosApiUrl: "",
      maxUserSessions: 2,
    }),
  );
  const configFile = join(directory, "wrangler.json");
  await writeFile(
    configFile,
    `${JSON.stringify(
      createWranglerConfig(config, {
        repoRoot,
        configDirectory: directory,
      }),
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  const dockerCheck = Bun.spawn(
    [
      "docker",
      "build",
      "--check",
      "-f",
      resolve(repoRoot, "apps/sandbox/Dockerfile"),
      repoRoot,
    ],
    {
      cwd: repoRoot,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const dockerCheckCode = await dockerCheck.exited;
  if (dockerCheckCode !== 0) {
    throw new Error(`Dockerfile check exited with status ${dockerCheckCode}`);
  }
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(repoRoot, "node_modules/wrangler/bin/wrangler.js"),
      "deploy",
      "--dry-run",
      "--config",
      configFile,
      "--outdir",
      join(directory, "dist"),
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: undefined,
        CLOUDFLARE_API_KEY: undefined,
        CLOUDFLARE_EMAIL: undefined,
      },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const code = await child.exited;
  if (code !== 0)
    throw new Error(`Wrangler dry-run exited with status ${code}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
