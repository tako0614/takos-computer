/**
 * takos-executor-host Worker (takos-computer version)
 *
 * Thin proxy that manages executor containers and forwards all Control RPC
 * requests to the main takos-web worker via the TAKOS_CONTROL service binding.
 *
 * Binding proxies (/proxy/db/*, /proxy/offload/*, etc.) are handled locally
 * since they need direct CF binding access for low latency.
 *
 * Control RPC (/rpc/control/*, /proxy/heartbeat, /proxy/run/*) is forwarded
 * to the main takos worker which has DB/service access.
 */

import {
  HostContainerInternals,
  HostContainerRuntime,
} from './container-runtime.ts';
import {
  dispatchAgentExecutorStart,
  forwardAgentExecutorDispatch,
  resolveAgentExecutorServiceId,
  type AgentExecutorDispatchPayload,
  type AgentExecutorControlConfig,
} from './executor-dispatch.ts';
import {
  buildAgentExecutorContainerEnvVars,
  buildAgentExecutorProxyConfig,
} from './executor-proxy-config.ts';
import { constantTimeEqual } from './crypto-utils.ts';
import {
  ok,
  err,
  unauthorized,
  recordProxyUsage,
  getProxyUsageSnapshot,
  isControlRpcPath,
  forwardToControlPlane,
} from './executor-utils.ts';
import type {
  AgentExecutorEnv,
  ProxyTokenInfo,
  Env,
} from './executor-utils.ts';
import {
  getRequiredProxyCapability,
  validateProxyResourceAccess,
  claimsMatchRequestBody,
} from './executor-auth.ts';
import {
  handleDbProxy,
  handleR2Proxy,
  handleNotifierProxy,
  handleVectorizeProxy,
  handleAiProxy,
  handleEgressProxy,
  handleRuntimeProxy,
  handleBrowserProxy,
  handleQueueProxy,
} from './executor-proxy-handlers.ts';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { AgentExecutorEnv, ProxyTokenInfo };
export { getRequiredProxyCapability, validateProxyResourceAccess };

// ---------------------------------------------------------------------------
// Durable Object — TakosAgentExecutorContainer
// ---------------------------------------------------------------------------

export class TakosAgentExecutorContainer extends HostContainerRuntime<Env> {
  defaultPort = 8080;
  sleepAfter = '5m';
  pingEndpoint = 'container/health';

  private cachedTokens: Map<string, ProxyTokenInfo> | null = null;

  constructor(ctx: DurableObjectState<Record<string, never>>, env: Env) {
    super(ctx, env);
    this.envVars = buildAgentExecutorContainerEnvVars(env);
  }

  async dispatchStart(body: AgentExecutorDispatchPayload): Promise<import('./executor-dispatch.ts').AgentExecutorDispatchResult> {
    const serviceId = resolveAgentExecutorServiceId(body);
    if (!serviceId) {
      return {
        ok: false,
        status: 400,
        body: JSON.stringify({ error: 'Missing serviceId or workerId' }),
      };
    }
    const controlConfig: AgentExecutorControlConfig = buildAgentExecutorProxyConfig(this.env, {
      runId: body.runId,
      serviceId,
    });
    const tokenMap: Record<string, ProxyTokenInfo> = {
      [controlConfig.controlRpcToken]: { runId: body.runId, serviceId, capability: 'control' },
    };
    await this.ctx.storage.put('proxyTokens', tokenMap);
    this.cachedTokens = new Map(Object.entries(tokenMap));

    return await dispatchAgentExecutorStart({
      startAndWaitForPorts: this.startAndWaitForPorts.bind(this),
      fetch: async (request: Request) => {
        this.renewActivityTimeout();
        const tcpPort = (this as unknown as HostContainerInternals).container.getTcpPort(8080);
        return await tcpPort.fetch(request.url.replace('https:', 'http:'), request);
      },
    }, body, controlConfig);
  }

  async verifyProxyToken(token: string): Promise<ProxyTokenInfo | null> {
    if (!this.cachedTokens) {
      const stored = await this.ctx.storage.get<Record<string, ProxyTokenInfo>>('proxyTokens');
      if (!stored) return null;
      this.cachedTokens = new Map(Object.entries(stored));
    }
    for (const [storedToken, info] of this.cachedTokens) {
      if (constantTimeEqual(token, storedToken)) return info;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  return null;
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', service: 'takos-executor-host' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/internal/proxy-usage' && request.method === 'GET') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'takos-executor-host',
        counts: getProxyUsageSnapshot(),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // /dispatch — called by takos-runner via service binding
    if (path === '/dispatch' && request.method === 'POST') {
      const body = await request.json() as AgentExecutorDispatchPayload;
      const { runId } = body;

      if (!runId) {
        return new Response(JSON.stringify({ error: 'Missing runId' }), { status: 400 });
      }

      const stub = env.EXECUTOR_CONTAINER.getByName(runId);
      return await forwardAgentExecutorDispatch(stub, body);
    }

    // /proxy/* and /rpc/control/* — called by executor/container with per-run tokens
    if (path.startsWith('/proxy/') || path.startsWith('/rpc/control/')) {
      const runId = request.headers.get('X-Takos-Run-Id');
      const token = extractBearerToken(request.headers.get('Authorization'));
      if (!runId || !token) {
        return unauthorized();
      }

      const stub = env.EXECUTOR_CONTAINER.getByName(runId);
      const tokenInfo = await stub.verifyProxyToken(token);
      if (!tokenInfo) {
        return unauthorized();
      }

      const claims: Record<string, unknown> = {
        run_id: tokenInfo.runId,
        service_id: tokenInfo.serviceId,
        worker_id: tokenInfo.serviceId,
        proxy_capabilities: [tokenInfo.capability],
      };

      if (request.method !== 'POST' && request.method !== 'GET') {
        return err('Method not allowed', 405);
      }

      const isBinaryR2Put = request.method === 'POST'
        && (request.headers.get('Content-Type') || '').startsWith('application/octet-stream')
        && (path === '/proxy/offload/put' || path === '/proxy/git-objects/put');

      const body = isBinaryR2Put
        ? {} as Record<string, unknown>
        : request.method === 'POST'
          ? await request.json() as Record<string, unknown>
          : Object.fromEntries(url.searchParams.entries());
      if (!claimsMatchRequestBody(claims, body)) {
        return unauthorized();
      }
      const requiredCapability = getRequiredProxyCapability(path);
      if (!requiredCapability || requiredCapability !== tokenInfo.capability) {
        return unauthorized();
      }
      if (!validateProxyResourceAccess(path, claims, body)) {
        return unauthorized();
      }

      recordProxyUsage(path);

      // Forward control RPC paths to the main takos-web worker
      if (isControlRpcPath(path)) {
        const forwarded = await forwardToControlPlane(path, body, env);
        if (forwarded) return forwarded;
        // If TAKOS_CONTROL not configured, return error (no local fallback in takos-computer)
        return err('TAKOS_CONTROL service binding not configured', 503);
      }

      // CF binding proxy endpoints (handled locally)
      if (path.startsWith('/proxy/db/')) {
        return handleDbProxy(path, body, env);
      }
      if (path.startsWith('/proxy/offload/')) {
        return handleR2Proxy(path, '/proxy/offload', body, env.TAKOS_OFFLOAD, isBinaryR2Put ? request : undefined);
      }
      if (path.startsWith('/proxy/git-objects/')) {
        if (!env.GIT_OBJECTS) return err('GIT_OBJECTS R2 bucket not configured', 503);
        return handleR2Proxy(path, '/proxy/git-objects', body, env.GIT_OBJECTS, isBinaryR2Put ? request : undefined);
      }
      if (path === '/proxy/do/fetch') {
        return handleNotifierProxy(path, body, env);
      }
      if (path.startsWith('/proxy/vectorize/')) {
        return handleVectorizeProxy(path, body, env);
      }
      if (path.startsWith('/proxy/ai/')) {
        return handleAiProxy(path, body, env);
      }
      if (path === '/proxy/egress/fetch') {
        return handleEgressProxy(body, env);
      }
      if (path === '/proxy/runtime/fetch') {
        return handleRuntimeProxy(body, env);
      }
      if (path === '/proxy/browser/fetch') {
        return handleBrowserProxy(body, env);
      }
      if (path.startsWith('/proxy/queue/')) {
        return handleQueueProxy(path, body, env);
      }

      return err(`Unknown proxy path: ${path}`, 404);
    }

    return new Response('takos-executor-host', { status: 200 });
  },
} satisfies ExportedHandler<Env>;
