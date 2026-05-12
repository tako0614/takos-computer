export type HostContainerTcpPortFetcher = {
  fetch(url: string, request: Request): Promise<Response>;
};

export interface HostContainerInternals {
  container: {
    getTcpPort(port: number): HostContainerTcpPortFetcher;
  };
}

export interface HostContainerStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean | void>;
}

export interface HostContainerContext {
  storage: HostContainerStorage;
}

export class LocalHostContainerRuntime<Env = unknown> {
  ctx: HostContainerContext;
  env: Env;
  envVars: Record<string, string> = {};

  constructor(ctx: HostContainerContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  /**
   * `@cloudflare/containers`'s `Container` exposes a `container` field with
   * a `getTcpPort()` method that proxies HTTP into the sandboxed container.
   * Declaring it here keeps the structural type identical between the
   * Cloudflare runtime and the local fallback so consumers never need a
   * platform-shim cast. The local fallback throws because it cannot host a
   * sidecar container; if this is invoked in local mode the operator
   * configuration is wrong.
   */
  get container(): {
    getTcpPort(port: number): HostContainerTcpPortFetcher;
  } {
    throw new Error(
      "container.getTcpPort is unavailable in LocalHostContainerRuntime; " +
        "run inside Cloudflare Workers with @cloudflare/containers installed",
    );
  }

  async startAndWaitForPorts(_ports?: number | number[]): Promise<void> {}

  renewActivityTimeout(): void {}

  async destroy(): Promise<void> {}
}

async function importContainerRuntime(): Promise<
  typeof import("@cloudflare/containers") | null
> {
  try {
    return await import("@cloudflare/containers");
  } catch (error) {
    if (typeof Deno !== "undefined") return null;
    throw error;
  }
}

const runtimeModule = await importContainerRuntime();

export const HostContainerRuntime = (
  runtimeModule?.Container ?? LocalHostContainerRuntime
) as typeof LocalHostContainerRuntime;

export const Container = (
  runtimeModule?.Container ?? LocalHostContainerRuntime
) as typeof LocalHostContainerRuntime;
