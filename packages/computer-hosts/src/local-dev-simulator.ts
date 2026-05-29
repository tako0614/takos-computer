import { createSandboxServiceApp } from "@takos-computer/sandbox-service";
import worker, { type SandboxSessionContainer } from "./sandbox-host.ts";
import { constantTimeEqual } from "./crypto-utils.ts";
import type { DurableObjectId, DurableObjectStub } from "./cf-types.ts";
import { generateProxyToken } from "./proxy-token.ts";
import type {
  CreateSandboxSessionPayload,
  KVNamespace,
  SandboxHostEnv,
  SandboxSessionState,
  SandboxSessionTokenInfo,
} from "./sandbox-session-types.ts";

/**
 * Platform-shim bridges for the local Deno simulator.
 *
 * The simulator implements the runtime surface of Cloudflare Workers Durable
 * Object stubs and namespaces using plain Deno classes. The classes implement
 * the RPC methods of `SandboxSessionContainer` directly (no DO transport) and
 * therefore do not satisfy the Cloudflare-shaped `fetch(input, init?)` /
 * `DurableObjectStubOf<T>` contracts at the type level even though they are
 * structurally interchangeable at runtime.
 *
 * These two helpers are the single named boundary between the Deno simulator
 * and the Worker environment types. Production code never reaches them.
 */
function bridgeLocalSessionStub(
  session: LocalSandboxSession,
): DurableObjectStub & SandboxSessionContainer {
  return session as unknown as DurableObjectStub & SandboxSessionContainer;
}

function bridgeLocalSandboxNamespace(
  namespace: LocalSandboxSessionNamespace,
): SandboxHostEnv["SANDBOX_CONTAINER"] {
  return namespace as unknown as SandboxHostEnv["SANDBOX_CONTAINER"];
}

const DEFAULT_LOCAL_PORT = 8788;
const DEFAULT_LOCAL_WORKSPACE_ROOT = ".takos-computer-local/workspaces";

export const LOCAL_DEV_DEFAULTS = {
  hostAuthToken: "local-host-token",
  publishedMcpAuthToken: "local-published-mcp-token",
  mcpAuthToken: "local-mcp-token",
} as const;

type WorkerFetch = (
  request: Request,
  env: SandboxHostEnv,
) => Promise<Response>;

export interface LocalDevSimulatorOptions {
  workspaceRoot?: string;
  hostAuthToken?: string;
  publishedMcpAuthToken?: string;
  mcpAuthToken?: string;
  takosApiUrl?: string;
  takosToken?: string;
  trustRoutedGuiApi?: boolean;
  sessionIndex?: KVNamespace;
}

export interface LocalDevSandboxHost {
  env: SandboxHostEnv;
  fetch: (request: Request) => Promise<Response>;
  sessionIndex: KVNamespace;
  sandboxContainer: LocalSandboxSessionNamespace;
}

export class MemoryKvNamespace implements KVNamespace {
  private values = new Map<string, string>();

  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get(key: string, options: { type: "json" }): Promise<unknown>;
  get(
    key: string,
    options?: { type?: "text" | "json" },
  ): Promise<string | null | unknown> {
    const value = this.values.get(key) ?? null;
    if (options?.type === "json") {
      return Promise.resolve(value === null ? null : JSON.parse(value));
    }
    return Promise.resolve(value);
  }

  put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const keys = [...this.values.keys()]
      .filter((name) => !options?.prefix || name.startsWith(options.prefix))
      .slice(0, options?.limit)
      .map((name) => ({ name }));
    return Promise.resolve({ keys, list_complete: true });
  }
}

class LocalDurableObjectId implements DurableObjectId {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  toString(): string {
    return this.name;
  }

  equals(other: DurableObjectId): boolean {
    return other.toString() === this.name;
  }
}

class LocalSandboxSession {
  readonly id: DurableObjectId;
  readonly name: string;
  private state: SandboxSessionState | null = null;
  private proxyToken: string | null = null;
  private sandboxApp: ReturnType<typeof createSandboxServiceApp>["app"] | null =
    null;

  constructor(
    id: DurableObjectId,
    private readonly env: SandboxHostEnv,
    private readonly workspaceRoot: string,
  ) {
    this.id = id;
    this.name = id.toString();
  }

  fetch(): Promise<Response> {
    return Promise.resolve(
      Response.json(
        { error: "Local sandbox sessions expose RPC methods only" },
        { status: 501 },
      ),
    );
  }

  async createSession(
    payload: CreateSandboxSessionPayload,
  ): Promise<{ ok: true; proxyToken: string }> {
    const sessionWorkspace = `${this.workspaceRoot}/${
      safePathSegment(this.id.name ?? this.id.toString())
    }`;
    await Deno.mkdir(sessionWorkspace, { recursive: true });

    this.sandboxApp = createSandboxServiceApp({
      serviceName: "local-sandbox",
      workspaceRoot: sessionWorkspace,
      mcpAuthToken: this.env.MCP_AUTH_TOKEN,
    }).app;

    this.proxyToken = generateProxyToken();
    this.state = {
      ...payload,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    return { ok: true, proxyToken: this.proxyToken };
  }

  verifyProxyToken(
    token: string,
  ): Promise<SandboxSessionTokenInfo | null> {
    if (!this.proxyToken || !this.state) return Promise.resolve(null);
    if (!constantTimeEqual(token, this.proxyToken)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      sessionId: this.state.sessionId,
      spaceId: this.state.spaceId,
      userId: this.state.userId,
    });
  }

  getSessionState(): Promise<SandboxSessionState | null> {
    return Promise.resolve(this.state);
  }

  destroySession(): Promise<void> {
    this.state = null;
    this.proxyToken = null;
    this.sandboxApp = null;
    return Promise.resolve();
  }

  forwardToContainer(path: string, init?: RequestInit): Promise<Response> {
    if (!this.state || !this.sandboxApp) {
      return Promise.resolve(
        Response.json({ error: "Session not found" }, { status: 404 }),
      );
    }
    const request = new Request(`http://local-sandbox${path}`, init);
    return Promise.resolve(this.sandboxApp.fetch(request));
  }
}

export class LocalSandboxSessionNamespace {
  private sessions = new Map<string, LocalSandboxSession>();

  constructor(
    private readonly env: SandboxHostEnv,
    private readonly workspaceRoot: string,
  ) {}

  idFromName(name: string): DurableObjectId {
    return new LocalDurableObjectId(name);
  }

  idFromString(id: string): DurableObjectId {
    return new LocalDurableObjectId(id);
  }

  newUniqueId(): DurableObjectId {
    return new LocalDurableObjectId(crypto.randomUUID());
  }

  get(
    id: DurableObjectId,
  ): DurableObjectStub & SandboxSessionContainer {
    const name = id.name ?? id.toString();
    let session = this.sessions.get(name);
    if (!session) {
      session = new LocalSandboxSession(id, this.env, this.workspaceRoot);
      this.sessions.set(name, session);
    }
    return bridgeLocalSessionStub(session);
  }
}

export function createLocalDevSandboxHost(
  options: LocalDevSimulatorOptions = {},
): LocalDevSandboxHost {
  const sessionIndex = options.sessionIndex ?? new MemoryKvNamespace();
  const env = {
    SANDBOX_HOST_AUTH_TOKEN: options.hostAuthToken ??
      LOCAL_DEV_DEFAULTS.hostAuthToken,
    PUBLISHED_MCP_AUTH_TOKEN: options.publishedMcpAuthToken ??
      LOCAL_DEV_DEFAULTS.publishedMcpAuthToken,
    MCP_AUTH_TOKEN: options.mcpAuthToken ?? LOCAL_DEV_DEFAULTS.mcpAuthToken,
    TAKOS_API_URL: options.takosApiUrl,
    TAKOS_TOKEN: options.takosToken,
    TAKOS_TRUST_ROUTED_GUI_API: options.trustRoutedGuiApi ? "1" : undefined,
    SESSION_INDEX: sessionIndex,
  } as SandboxHostEnv;
  const sandboxContainer = new LocalSandboxSessionNamespace(
    env,
    options.workspaceRoot ?? DEFAULT_LOCAL_WORKSPACE_ROOT,
  );
  env.SANDBOX_CONTAINER = bridgeLocalSandboxNamespace(sandboxContainer);

  return {
    env,
    sessionIndex,
    sandboxContainer,
    fetch: (request) => (worker.fetch as WorkerFetch)(request, env),
  };
}

export function startLocalDevSandboxHost(
  options: LocalDevSimulatorOptions & { port?: number } = {},
): LocalDevSandboxHost & { server: Deno.HttpServer } {
  const host = createLocalDevSandboxHost(options);
  const port = options.port ?? DEFAULT_LOCAL_PORT;
  const server = Deno.serve({ port }, host.fetch);
  return { ...host, server };
}

function safePathSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  return normalized || "session";
}

function readEnvOrDefault(name: string, fallback: string): string {
  const value = Deno.env.get(name)?.trim();
  return value || fallback;
}

if (import.meta.main) {
  const port = Number.parseInt(
    Deno.env.get("PORT") ?? `${DEFAULT_LOCAL_PORT}`,
    10,
  );
  const workspaceRoot = readEnvOrDefault(
    "TAKOS_COMPUTER_LOCAL_WORKSPACE",
    DEFAULT_LOCAL_WORKSPACE_ROOT,
  );
  const hostAuthToken = readEnvOrDefault(
    "SANDBOX_HOST_AUTH_TOKEN",
    LOCAL_DEV_DEFAULTS.hostAuthToken,
  );
  const publishedMcpAuthToken = readEnvOrDefault(
    "PUBLISHED_MCP_AUTH_TOKEN",
    LOCAL_DEV_DEFAULTS.publishedMcpAuthToken,
  );
  const mcpAuthToken = readEnvOrDefault(
    "MCP_AUTH_TOKEN",
    LOCAL_DEV_DEFAULTS.mcpAuthToken,
  );

  startLocalDevSandboxHost({
    port,
    workspaceRoot,
    hostAuthToken,
    publishedMcpAuthToken,
    mcpAuthToken,
    takosApiUrl: Deno.env.get("TAKOS_API_URL") ?? undefined,
    takosToken: Deno.env.get("TAKOS_TOKEN") ?? undefined,
    trustRoutedGuiApi: Deno.env.get("TAKOS_TRUST_ROUTED_GUI_API") === "1",
  });

  console.log(`takos-computer local simulator listening on :${port}`);
  console.log(
    `dashboard: http://127.0.0.1:${port}/gui?authToken=${hostAuthToken}`,
  );
  console.log(`published MCP bearer token: ${publishedMcpAuthToken}`);
  console.log(`workspace root: ${workspaceRoot}`);
}
