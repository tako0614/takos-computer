/**
 * SandboxSessionContainer — Durable Object that owns one sandbox session.
 *
 * Persists proxy tokens + session state, manages the container sidecar
 * lifecycle, and forwards HTTP requests to the container TCP port. The
 * Hono surface that mounts these DOs lives in `sandbox-host.ts`.
 */

import { HostContainerRuntime } from "./container-runtime.ts";
import { generateProxyToken } from "./proxy-token.ts";
import { constantTimeEqual } from "./crypto-utils.ts";
import type { DurableObjectStub } from "./cf-types.ts";
import type {
  CreateSandboxSessionPayload,
  SandboxHostEnv,
  SandboxSessionState,
  SandboxSessionTokenInfo,
} from "./sandbox-session-types.ts";

const PROXY_TOKENS_STORAGE_KEY = "proxyTokens";
const SESSION_STATE_STORAGE_KEY = "sessionState";

export function resolveContainerMcpAuthToken(
  env: SandboxHostEnv,
): string | undefined {
  return env.MCP_AUTH_TOKEN || undefined;
}

export function getDOStub(
  env: SandboxHostEnv,
  sessionId: string,
): DurableObjectStub & SandboxSessionContainer {
  const id = env.SANDBOX_CONTAINER.idFromName(sessionId);
  return env.SANDBOX_CONTAINER.get(id);
}

export class SandboxSessionContainer
  extends HostContainerRuntime<SandboxHostEnv> {
  defaultPort = 8080;
  sleepAfter = "10m";
  pingEndpoint = "internal/healthz";

  private cachedTokens: Map<string, SandboxSessionTokenInfo> | null = null;
  private sessionState: SandboxSessionState | null = null;
  private proxyTokensLoaded = false;
  private sessionStateLoaded = false;

  private applyContainerEnv(): void {
    const nextEnvVars = { ...this.envVars };
    const mcpAuthToken = resolveContainerMcpAuthToken(this.env);
    if (mcpAuthToken) {
      nextEnvVars.MCP_AUTH_TOKEN = mcpAuthToken;
    } else {
      delete nextEnvVars.MCP_AUTH_TOKEN;
    }

    if (this.env.TAKOS_TOKEN) {
      nextEnvVars.TAKOS_TOKEN = this.env.TAKOS_TOKEN;
    } else {
      delete nextEnvVars.TAKOS_TOKEN;
    }

    if (this.env.TAKOS_API_URL) {
      nextEnvVars.TAKOS_API_URL = this.env.TAKOS_API_URL;
    } else {
      delete nextEnvVars.TAKOS_API_URL;
    }

    const spaceId = this.sessionState?.spaceId;
    if (spaceId) {
      nextEnvVars.TAKOS_SPACE_ID = spaceId;
    } else {
      delete nextEnvVars.TAKOS_SPACE_ID;
    }
    this.envVars = nextEnvVars;
  }

  private async ensureProxyTokensLoaded(): Promise<void> {
    if (this.proxyTokensLoaded) return;
    const stored = await this.ctx.storage.get<
      Record<string, SandboxSessionTokenInfo>
    >(PROXY_TOKENS_STORAGE_KEY);
    this.cachedTokens = stored ? new Map(Object.entries(stored)) : null;
    this.proxyTokensLoaded = true;
  }

  private async ensureSessionStateLoaded(): Promise<void> {
    if (this.sessionStateLoaded) return;
    this.sessionState = await this.ctx.storage.get<SandboxSessionState>(
      SESSION_STATE_STORAGE_KEY,
    ) ?? null;
    this.sessionStateLoaded = true;
  }

  private async persistProxyTokens(
    tokenMap: Record<string, SandboxSessionTokenInfo>,
  ): Promise<void> {
    await this.ctx.storage.put(PROXY_TOKENS_STORAGE_KEY, tokenMap);
    this.cachedTokens = new Map(Object.entries(tokenMap));
    this.proxyTokensLoaded = true;
  }

  private async persistSessionState(
    sessionState: SandboxSessionState,
  ): Promise<void> {
    await this.ctx.storage.put(SESSION_STATE_STORAGE_KEY, sessionState);
    this.sessionState = sessionState;
    this.sessionStateLoaded = true;
  }

  private async clearPersistedSession(): Promise<void> {
    this.cachedTokens = null;
    this.sessionState = null;
    this.proxyTokensLoaded = true;
    this.sessionStateLoaded = true;
    await Promise.all([
      this.ctx.storage.delete(PROXY_TOKENS_STORAGE_KEY),
      this.ctx.storage.delete(SESSION_STATE_STORAGE_KEY),
    ]);
  }

  async createSession(
    payload: CreateSandboxSessionPayload,
  ): Promise<{ ok: true; proxyToken: string }> {
    const proxyToken = generateProxyToken();
    const tokenInfo: SandboxSessionTokenInfo = {
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId,
    };

    const tokenMap: Record<string, SandboxSessionTokenInfo> = {
      [proxyToken]: tokenInfo,
    };
    const sessionState: SandboxSessionState = {
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId,
      status: "starting",
      createdAt: new Date().toISOString(),
    };
    await this.persistProxyTokens(tokenMap);
    await this.persistSessionState(sessionState);
    this.applyContainerEnv();

    try {
      await this.startAndWaitForPorts([8080]);
      const activeState: SandboxSessionState = {
        ...sessionState,
        status: "active",
      };
      await this.persistSessionState(activeState);
      return { ok: true, proxyToken };
    } catch (error) {
      await Promise.allSettled([this.clearPersistedSession(), this.destroy()]);
      throw error;
    }
  }

  async verifyProxyToken(
    token: string,
  ): Promise<SandboxSessionTokenInfo | null> {
    await this.ensureProxyTokensLoaded();
    if (!this.cachedTokens) return null;
    for (const [storedToken, info] of this.cachedTokens) {
      if (constantTimeEqual(token, storedToken)) return info;
    }
    return null;
  }

  async getSessionState(): Promise<SandboxSessionState | null> {
    await this.ensureSessionStateLoaded();
    return this.sessionState;
  }

  async destroySession(): Promise<void> {
    await this.ensureSessionStateLoaded();
    if (this.sessionState) {
      await this.persistSessionState({
        ...this.sessionState,
        status: "stopped",
      });
    }
    await this.clearPersistedSession();
    await this.destroy();
  }

  /** Forward an HTTP request to the container. */
  async forwardToContainer(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    await this.ensureSessionStateLoaded();
    this.applyContainerEnv();
    this.renewActivityTimeout();
    const tcpPort = this.container.getTcpPort(8080);
    const request = new Request(`http://internal${path}`, init);
    return tcpPort.fetch(request.url, request);
  }
}
