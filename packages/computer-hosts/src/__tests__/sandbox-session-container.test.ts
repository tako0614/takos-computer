import { expect, test } from "bun:test";
import type { HostContainerContext } from "../container-runtime.ts";
import { SandboxSessionContainer } from "../sandbox-host.ts";
import type {
  CreateSandboxSessionPayload,
  SandboxHostEnv,
  SandboxSessionTokenInfo,
} from "../sandbox-session-types.ts";

type HostContainerStorage = HostContainerContext["storage"];

class MemoryStorage implements HostContainerStorage {
  private values = new Map<string, unknown>();

  get<T = unknown>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(key) as T | undefined);
  }

  put(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key));
  }
}

class TestSandboxSessionContainer extends SandboxSessionContainer {
  startPorts: Array<number | number[] | undefined> = [];
  destroyCalls = 0;
  forwardedPaths: string[] = [];
  // Simulated container lifecycle for forward / restart tests.
  containerRunning = false;
  containerStatus = "stopped";

  override startAndWaitForPorts(
    ports?: number | number[],
  ): Promise<void> {
    this.startPorts.push(ports);
    this.containerRunning = true;
    this.containerStatus = "healthy";
    return Promise.resolve();
  }

  override destroy(): Promise<void> {
    this.destroyCalls += 1;
    this.containerRunning = false;
    this.containerStatus = "stopped";
    return Promise.resolve();
  }

  override get container(): {
    running: boolean;
    getTcpPort(port: number): { fetch(url: string, request: Request): Promise<Response> };
  } {
    return {
      running: this.containerRunning,
      getTcpPort: (_port: number) => ({
        fetch: (_url: string, request: Request) => {
          this.forwardedPaths.push(new URL(request.url).pathname);
          return Promise.resolve(Response.json({ ok: true }));
        },
      }),
    };
  }

  override getState(): Promise<{ status: string }> {
    return Promise.resolve({ status: this.containerStatus });
  }
}

const MCP_AUTH_TOKEN = "test-mcp-token";
const TAKOS_TOKEN = "test-takos-token";
const TAKOS_API_URL = "https://takos.test";

function createEnv(): SandboxHostEnv {
  return {
    MCP_AUTH_TOKEN,
    TAKOS_API_URL,
    TAKOS_TOKEN,
    SANDBOX_CONTAINER: {
      idFromName(name: string) {
        return name as never;
      },
      idFromString(name: string) {
        return name as never;
      },
      newUniqueId() {
        return "unique-id" as never;
      },
      get() {
        throw new Error("not used in direct DO tests");
      },
    } as SandboxHostEnv["SANDBOX_CONTAINER"],
  };
}

function createPayload(
  overrides: Partial<CreateSandboxSessionPayload> = {},
): CreateSandboxSessionPayload {
  return {
    sessionId: "session-1",
    spaceId: "space-1",
    userId: "user-1",
    ...overrides,
  };
}

test("sandbox session container passes MCP auth token into the container env", async () => {
  const ctx: HostContainerContext = { storage: new MemoryStorage() };
  const container = new TestSandboxSessionContainer(ctx, createEnv());

  await container.createSession(createPayload());

  expect(container.pingEndpoint).toEqual("internal/healthz");
  // SECURITY (S1): TAKOS_TOKEN must NOT be persisted in the container env even
  // when configured on the host — it is delivered per-exec instead.
  expect(container.envVars).toEqual({
    MCP_AUTH_TOKEN,
    TAKOS_API_URL,
    TAKOS_SPACE_ID: "space-1",
  });
  expect(container.envVars.TAKOS_TOKEN).toBeUndefined();
  expect(container.startPorts).toEqual([[8080]]);
});

test("sandbox session container does not use host auth token as MCP fallback", async () => {
  const ctx: HostContainerContext = { storage: new MemoryStorage() };
  const env = createEnv();
  env.SANDBOX_HOST_AUTH_TOKEN = "host-admin-token";
  delete env.MCP_AUTH_TOKEN;
  const container = new TestSandboxSessionContainer(ctx, env);

  await container.createSession(createPayload());

  expect(container.envVars).toEqual({
    TAKOS_API_URL,
    TAKOS_SPACE_ID: "space-1",
  });
});

test("sandbox session container hydrates persisted session state and clears it on destroy", async () => {
  const ctx: HostContainerContext = { storage: new MemoryStorage() };
  const first = new TestSandboxSessionContainer(ctx, createEnv());

  const payload = createPayload();
  const result = await first.createSession(payload);
  const createdState = await first.getSessionState();
  expect(createdState).toBeTruthy();

  const second = new TestSandboxSessionContainer(ctx, createEnv());

  expect(await second.getSessionState()).toEqual(createdState);
  expect(await second.verifyProxyToken(result.proxyToken)).toEqual(
    {
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId,
    } satisfies SandboxSessionTokenInfo,
  );

  await second.destroySession();

  const third = new TestSandboxSessionContainer(ctx, createEnv());
  expect(await third.getSessionState()).toEqual(null);
  expect(await third.verifyProxyToken(result.proxyToken)).toEqual(null);
  expect(second.destroyCalls).toEqual(1);
});

test("createSession reuses a live session and keeps the proxy token (idempotent)", async () => {
  const ctx: HostContainerContext = { storage: new MemoryStorage() };
  const container = new TestSandboxSessionContainer(ctx, createEnv());

  const first = await container.createSession(createPayload());
  const second = await container.createSession(createPayload());

  // Same owner, still live -> reuse: token is NOT rotated and the container is
  // not torn down (no second fresh start).
  expect(second.proxyToken).toEqual(first.proxyToken);
  expect(second.reused).toEqual(true);
  expect(container.destroyCalls).toEqual(0);
  expect(await container.verifyProxyToken(first.proxyToken)).toBeTruthy();
});

test("createSession refuses to re-home a live session onto a different owner", async () => {
  const ctx: HostContainerContext = { storage: new MemoryStorage() };
  const container = new TestSandboxSessionContainer(ctx, createEnv());

  await container.createSession(createPayload({ userId: "owner-a" }));

  let threw = false;
  try {
    await container.createSession(createPayload({ userId: "owner-b" }));
  } catch (err) {
    threw = true;
    expect(String(err)).toContain("different owner");
  }
  expect(threw).toBeTruthy();
  // The original owner's session is untouched.
  expect((await container.getSessionState())?.userId).toEqual("owner-a");
});

test("createSession with force gets a fresh container for an owner change", async () => {
  const ctx: HostContainerContext = { storage: new MemoryStorage() };
  const container = new TestSandboxSessionContainer(ctx, createEnv());

  const first = await container.createSession(createPayload({ userId: "owner-a" }));
  const second = await container.createSession(
    createPayload({ userId: "owner-b" }),
    { force: true },
  );

  expect(container.destroyCalls).toEqual(1); // prior container torn down
  expect(second.proxyToken).not.toEqual(first.proxyToken);
  expect((await container.getSessionState())?.userId).toEqual("owner-b");
});

test("forwardToContainer restarts a slept container and reconciles status", async () => {
  const ctx: HostContainerContext = { storage: new MemoryStorage() };
  const container = new TestSandboxSessionContainer(ctx, createEnv());
  await container.createSession(createPayload());

  // Simulate the framework's onActivityExpired() stopping the container after
  // the idle window, while DO state still says "active".
  container.containerRunning = false;
  container.containerStatus = "stopped";
  const startsBefore = container.startPorts.length;

  const response = await container.forwardToContainer("/mcp", { method: "POST" });

  expect(response.status).toEqual(200);
  // The forward auto-started the container instead of failing with 500.
  expect(container.startPorts.length).toEqual(startsBefore + 1);
  expect(container.forwardedPaths).toEqual(["/mcp"]);
  expect((await container.getSessionState())?.status).toEqual("active");
});

test("forwardToContainer does not restart an already-healthy container", async () => {
  const ctx: HostContainerContext = { storage: new MemoryStorage() };
  const container = new TestSandboxSessionContainer(ctx, createEnv());
  await container.createSession(createPayload()); // leaves container healthy
  const startsBefore = container.startPorts.length;

  await container.forwardToContainer("/mcp", { method: "POST" });

  expect(container.startPorts.length).toEqual(startsBefore);
});
