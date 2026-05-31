import { expect, test } from "bun:test";
import type { HostContainerContext } from "../container-runtime.ts";
import { SandboxSessionContainer } from "../sandbox-host.ts";
import type {
  CreateSandboxSessionPayload,
  SandboxHostEnv,
  SandboxSessionTokenInfo,
} from "../sandbox-session-types.ts";

function expect(condition: unknown).toBeTruthy(): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expect(actual: unknown).toEqual(expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

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

  override startAndWaitForPorts(
    ports?: number | number[],
  ): Promise<void> {
    this.startPorts.push(ports);
    return Promise.resolve();
  }

  override destroy(): Promise<void> {
    this.destroyCalls += 1;
    return Promise.resolve();
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
  expect(container.envVars).toEqual({
    MCP_AUTH_TOKEN,
    TAKOS_TOKEN,
    TAKOS_API_URL,
    TAKOS_SPACE_ID: "space-1",
  });
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
    TAKOS_TOKEN,
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
  expect(await second.verifyProxyToken(result.proxyToken)).toEqual({
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId,
    } satisfies SandboxSessionTokenInfo);

  await second.destroySession();

  const third = new TestSandboxSessionContainer(ctx, createEnv());
  expect(await third.getSessionState()).toEqual(null);
  expect(await third.verifyProxyToken(result.proxyToken)).toEqual(null);
  expect(second.destroyCalls).toEqual(1);
});
