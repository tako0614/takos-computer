import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createWranglerConfig,
  parseOpenTofuDeployConfig,
} from "./opentofu-deploy.ts";

const repoRoot = resolve(import.meta.dir, "..");
const checkContainerImage =
  "docker.io/oven/bun@sha256:50317d83cd5a5ae1d8b35b3379c69f57ce1a0dbf4def91f0965653d767851834";
const directory = await mkdtemp(
  join(tmpdir(), "takos-computer-wrangler-check-"),
);

async function runWranglerDryRun(
  configFile: string,
  outdir: string,
  environment?: string,
): Promise<void> {
  const args = [
    process.execPath,
    resolve(repoRoot, "node_modules/wrangler/bin/wrangler.js"),
    "deploy",
    "--dry-run",
    "--config",
    configFile,
    "--outdir",
    outdir,
  ];
  if (environment !== undefined) {
    args.push(`--env=${environment}`);
  }
  const child = Bun.spawn(args, {
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
  });
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`Wrangler dry-run exited with status ${code}`);
  }
}

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
      containerImage: checkContainerImage,
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
  await runWranglerDryRun(configFile, join(directory, "generated-dist"));

  // Validate the checked-in standalone template too. Replace only operator
  // placeholders and the Dockerfile build with check-safe values; its entry,
  // Durable Object bindings, migrations, and environment overlays remain the
  // repository-owned template under test.
  const staticTemplate = await readFile(
    resolve(repoRoot, "deploy/wrangler.sandbox-host.toml"),
    "utf8",
  );
  const staticConfigFile = join(directory, "wrangler.static.toml");
  await writeFile(
    staticConfigFile,
    staticTemplate
      .replace(
        '../packages/computer-hosts/src/sandbox-host-worker.ts',
        resolve(
          repoRoot,
          "packages/computer-hosts/src/sandbox-host-worker.ts",
        ),
      )
      .replaceAll("../apps/sandbox/Dockerfile", checkContainerImage)
      .replaceAll('image_build_context = ".."', `image_build_context = "${
        repoRoot.replaceAll("\\", "\\\\")
      }"`)
      .replace("REPLACE_WITH_KV_NAMESPACE_ID", "d".repeat(32))
      .replace("REPLACE_WITH_STAGING_KV_NAMESPACE_ID", "e".repeat(32)),
    { mode: 0o600 },
  );
  await runWranglerDryRun(
    staticConfigFile,
    join(directory, "static-production-dist"),
    "",
  );
  await runWranglerDryRun(
    staticConfigFile,
    join(directory, "static-staging-dist"),
    "staging",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
