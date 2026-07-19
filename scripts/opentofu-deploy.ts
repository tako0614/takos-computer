import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_ENV = "TAKOS_COMPUTER_DEPLOY_CONFIG";
const DEPLOY_KEYS = [
  "accountId",
  "workerName",
  "publicOrigin",
  "workersDev",
  "sessionIndexId",
  "containerImage",
  "containerMax",
  "compatibilityDate",
  "sourceDigest",
  "accountsIssuer",
  "workspaceId",
  "capsuleId",
  "appOidc",
  "oidcClientId",
  "oidcRedirectUri",
  "takosApiUrl",
  "maxUserSessions",
] as const;

export interface OpenTofuDeployConfig {
  accountId: string;
  workerName: string;
  publicOrigin: string;
  workersDev: boolean;
  sessionIndexId: string;
  containerImage: string;
  containerMax: number;
  compatibilityDate: string;
  sourceDigest: string;
  accountsIssuer: string;
  workspaceId: string;
  capsuleId: string;
  appOidc: boolean;
  oidcClientId: string;
  oidcRedirectUri: string;
  takosApiUrl: string;
  maxUserSessions: number;
}

type WranglerConfig = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...DEPLOY_KEYS].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function requiredString(
  value: Record<string, unknown>,
  key: keyof OpenTofuDeployConfig,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string") {
    throw new Error(`${CONFIG_ENV}.${key} must be a string`);
  }
  return candidate.trim();
}

function requiredBoolean(
  value: Record<string, unknown>,
  key: keyof OpenTofuDeployConfig,
): boolean {
  const candidate = value[key];
  if (typeof candidate !== "boolean") {
    throw new Error(`${CONFIG_ENV}.${key} must be a boolean`);
  }
  return candidate;
}

function boundedInteger(
  value: Record<string, unknown>,
  key: keyof OpenTofuDeployConfig,
  min: number,
  max: number,
): number {
  const candidate = value[key];
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < min ||
    candidate > max
  ) {
    throw new Error(
      `${CONFIG_ENV}.${key} must be an integer from ${min} through ${max}`,
    );
  }
  return candidate;
}

function bareHttpsOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTPS origin`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${label} must be an HTTPS origin`);
  }
  return url.origin;
}

function optionalHttpsUrl(value: string, label: string): string {
  if (value === "") return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  return url.href;
}

export function parseOpenTofuDeployConfig(raw: string): OpenTofuDeployConfig {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error(`${CONFIG_ENV} must be valid JSON`);
  }
  if (!isRecord(decoded) || !exactKeys(decoded)) {
    throw new Error(
      `${CONFIG_ENV} must use the closed deployment-config shape`,
    );
  }

  const config: OpenTofuDeployConfig = {
    accountId: requiredString(decoded, "accountId"),
    workerName: requiredString(decoded, "workerName"),
    publicOrigin: requiredString(decoded, "publicOrigin"),
    workersDev: requiredBoolean(decoded, "workersDev"),
    sessionIndexId: requiredString(decoded, "sessionIndexId"),
    containerImage: requiredString(decoded, "containerImage"),
    containerMax: boundedInteger(decoded, "containerMax", 1, 1000),
    compatibilityDate: requiredString(decoded, "compatibilityDate"),
    sourceDigest: requiredString(decoded, "sourceDigest"),
    accountsIssuer: requiredString(decoded, "accountsIssuer"),
    workspaceId: requiredString(decoded, "workspaceId"),
    capsuleId: requiredString(decoded, "capsuleId"),
    appOidc: requiredBoolean(decoded, "appOidc"),
    oidcClientId: requiredString(decoded, "oidcClientId"),
    oidcRedirectUri: requiredString(decoded, "oidcRedirectUri"),
    takosApiUrl: requiredString(decoded, "takosApiUrl"),
    maxUserSessions: boundedInteger(decoded, "maxUserSessions", 1, 100),
  };

  if (!/^[a-f0-9]{32}$/u.test(config.accountId)) {
    throw new Error(
      `${CONFIG_ENV}.accountId must be a lowercase Cloudflare account id`,
    );
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(config.workerName)) {
    throw new Error(`${CONFIG_ENV}.workerName must be a lowercase DNS label`);
  }
  config.publicOrigin = bareHttpsOrigin(
    config.publicOrigin,
    `${CONFIG_ENV}.publicOrigin`,
  );
  if (!/^[a-f0-9]{32}$/u.test(config.sessionIndexId)) {
    throw new Error(
      `${CONFIG_ENV}.sessionIndexId must be a Cloudflare KV namespace id`,
    );
  }
  if (config.containerImage !== "" && /\s/u.test(config.containerImage)) {
    throw new Error(`${CONFIG_ENV}.containerImage must not contain whitespace`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(config.compatibilityDate)) {
    throw new Error(`${CONFIG_ENV}.compatibilityDate must be YYYY-MM-DD`);
  }
  if (!/^[a-f0-9]{64}$/u.test(config.sourceDigest)) {
    throw new Error(`${CONFIG_ENV}.sourceDigest must be a SHA-256 hex digest`);
  }
  if (config.accountsIssuer !== "") {
    config.accountsIssuer = bareHttpsOrigin(
      config.accountsIssuer,
      `${CONFIG_ENV}.accountsIssuer`,
    );
  }
  const ownerValues = [config.workspaceId, config.capsuleId];
  if (ownerValues.some(Boolean) && !ownerValues.every(Boolean)) {
    throw new Error("workspaceId and capsuleId must be configured together");
  }
  config.oidcRedirectUri = optionalHttpsUrl(
    config.oidcRedirectUri,
    `${CONFIG_ENV}.oidcRedirectUri`,
  );
  config.takosApiUrl = optionalHttpsUrl(
    config.takosApiUrl,
    `${CONFIG_ENV}.takosApiUrl`,
  );
  if (
    config.appOidc &&
    (!config.accountsIssuer || !config.oidcClientId || !config.oidcRedirectUri)
  ) {
    throw new Error(
      "appOidc requires accountsIssuer, oidcClientId, and oidcRedirectUri",
    );
  }
  return config;
}

function configPath(fromDirectory: string, absolutePath: string): string {
  return relative(fromDirectory, absolutePath).split(sep).join("/");
}

export function createWranglerConfig(
  config: OpenTofuDeployConfig,
  input: { repoRoot: string; configDirectory: string },
): WranglerConfig {
  const vars: Record<string, string> = {
    BASE_URL: config.publicOrigin,
    MCP_URL: `${config.publicOrigin}/mcp`,
    MAX_SANDBOX_SESSIONS_PER_USER: String(config.maxUserSessions),
  };
  if (config.accountsIssuer) vars.OIDC_ISSUER_URL = config.accountsIssuer;
  if (config.workspaceId && config.capsuleId) {
    vars.APP_WORKSPACE_ID = config.workspaceId;
    vars.APP_CAPSULE_ID = config.capsuleId;
  }
  if (config.appOidc) {
    vars.APP_AUTH_REQUIRED = "1";
    vars.OIDC_CLIENT_ID = config.oidcClientId;
    vars.OIDC_REDIRECT_URI = config.oidcRedirectUri;
  }
  if (config.takosApiUrl) vars.TAKOS_API_URL = config.takosApiUrl;

  return {
    $schema: configPath(
      input.configDirectory,
      resolve(input.repoRoot, "node_modules/wrangler/config-schema.json"),
    ),
    name: config.workerName,
    account_id: config.accountId,
    main: configPath(
      input.configDirectory,
      resolve(input.repoRoot, "packages/computer-hosts/src/sandbox-host.ts"),
    ),
    compatibility_date: config.compatibilityDate,
    compatibility_flags: [
      "nodejs_compat",
      "no_handle_cross_request_promise_resolution",
    ],
    workers_dev: config.workersDev,
    observability: { enabled: true },
    durable_objects: {
      bindings: [
        {
          name: "SANDBOX_CONTAINER",
          class_name: "SandboxSessionContainer",
        },
      ],
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: ["SandboxSessionContainer"],
      },
    ],
    containers: [
      {
        class_name: "SandboxSessionContainer",
        image:
          config.containerImage ||
          configPath(
            input.configDirectory,
            resolve(input.repoRoot, "apps/sandbox/Dockerfile"),
          ),
        image_build_context: configPath(input.configDirectory, input.repoRoot),
        instance_type: "basic",
        max_instances: config.containerMax,
      },
    ],
    kv_namespaces: [
      {
        binding: "SESSION_INDEX",
        id: config.sessionIndexId,
      },
    ],
    vars,
  };
}

export function deploymentSecrets(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const required = ["SANDBOX_HOST_AUTH_TOKEN", "MCP_AUTH_TOKEN"] as const;
  const result: Record<string, string> = {};
  for (const name of required) {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required for deployment`);
    result[name] = value;
  }
  for (const name of [
    "PUBLISHED_MCP_AUTH_TOKEN",
    "APP_SESSION_SECRET",
    "OIDC_CLIENT_SECRET",
    "TAKOS_TOKEN",
  ] as const) {
    const value = env[name]?.trim();
    if (value) result[name] = value;
  }
  return result;
}

async function exists(path: string): Promise<boolean> {
  return await stat(path).then(
    () => true,
    () => false,
  );
}

async function runCommand(
  command: string[],
  options: { cwd: string; env?: Record<string, string | undefined> },
): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`${command[0]} exited with status ${code}`);
  }
}

async function ensureDependencies(repoRoot: string): Promise<void> {
  const wranglerEntry = resolve(
    repoRoot,
    "node_modules/wrangler/bin/wrangler.js",
  );
  if (await exists(wranglerEntry)) return;
  await runCommand([process.execPath, "install", "--frozen-lockfile"], {
    cwd: repoRoot,
  });
  if (!(await exists(wranglerEntry))) {
    throw new Error(
      "Pinned Wrangler installation did not produce its entrypoint",
    );
  }
}

async function withGeneratedConfig<T>(
  repoRoot: string,
  config: OpenTofuDeployConfig,
  action: (input: {
    directory: string;
    configPath: string;
    wranglerEntry: string;
  }) => Promise<T>,
): Promise<T> {
  const parent = resolve(repoRoot, ".wrangler", "opentofu");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, `${config.workerName}-`));
  await chmod(directory, 0o700);
  const generated = createWranglerConfig(config, {
    repoRoot,
    configDirectory: directory,
  });
  const configFile = join(directory, "wrangler.json");
  await writeFile(configFile, `${JSON.stringify(generated, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    return await action({
      directory,
      configPath: configFile,
      wranglerEntry: resolve(repoRoot, "node_modules/wrangler/bin/wrangler.js"),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function deploy(
  repoRoot: string,
  config: OpenTofuDeployConfig,
): Promise<void> {
  await ensureDependencies(repoRoot);
  await withGeneratedConfig(repoRoot, config, async (generated) => {
    const secretFile = join(generated.directory, "secrets.json");
    await writeFile(
      secretFile,
      `${JSON.stringify(deploymentSecrets(process.env))}\n`,
      { mode: 0o600 },
    );
    await runCommand(
      [
        process.execPath,
        generated.wranglerEntry,
        "deploy",
        "--config",
        generated.configPath,
        "--secrets-file",
        secretFile,
      ],
      { cwd: repoRoot },
    );
  });
}

async function destroy(
  repoRoot: string,
  config: OpenTofuDeployConfig,
): Promise<void> {
  await ensureDependencies(repoRoot);
  await withGeneratedConfig(repoRoot, config, async (generated) => {
    await runCommand(
      [
        process.execPath,
        generated.wranglerEntry,
        "delete",
        config.workerName,
        "--force",
        "--config",
        generated.configPath,
      ],
      { cwd: repoRoot },
    );
  });
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (operation !== "deploy" && operation !== "destroy") {
    throw new Error("Usage: bun scripts/opentofu-deploy.ts <deploy|destroy>");
  }
  const raw = process.env[CONFIG_ENV];
  if (!raw) throw new Error(`${CONFIG_ENV} is required`);
  const config = parseOpenTofuDeployConfig(raw);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  if (operation === "deploy") await deploy(repoRoot, config);
  else await destroy(repoRoot, config);
}

if (import.meta.main) {
  await main();
}
