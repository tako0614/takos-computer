/**
 * takos-browser-host Worker
 *
 * Hosts BrowserSessionContainer (CF Containers DO sidecar).
 * Public API surface: MCP (tools) + VNC (display) + session lifecycle.
 * All browser/display/app interaction goes through MCP tools.
 *
 * Architecture:
 *   client → POST /session/:id/mcp → this worker → DO → container /mcp
 *   client → GET  /session/:id/vnc → this worker → DO → container /vnc (WebSocket)
 */

import {
  HostContainerInternals,
  HostContainerRuntime,
} from './container-runtime.ts';
import type { DurableObjectNamespace, R2Bucket } from './cf-types.ts';
import { Hono } from 'hono';
import { generateProxyToken } from './executor-proxy-config.ts';
import { constantTimeEqual } from './crypto-utils.ts';
import type {
  BrowserSessionTokenInfo,
  CreateSessionPayload,
  BrowserSessionState,
  KVNamespace,
} from './browser-session-types.ts';
import { dashboardHtml, viewerHtml, styleCss } from './gui/assets.ts';

// ---------------------------------------------------------------------------
// Environment types
// ---------------------------------------------------------------------------

interface BrowserHostEnv {
  BROWSER_CONTAINER: DurableObjectNamespace<BrowserSessionContainer>;
  BROWSER_CHECKPOINTS?: R2Bucket;
  TAKOS_EGRESS?: { fetch(request: Request): Promise<Response> };
  SESSION_INDEX?: KVNamespace;
}

type Env = BrowserHostEnv;

// ---------------------------------------------------------------------------
// Durable Object — BrowserSessionContainer
// ---------------------------------------------------------------------------

export class BrowserSessionContainer extends HostContainerRuntime<Env> {
  defaultPort = 8080;
  sleepAfter = '15m';
  pingEndpoint = 'healthz';

  private cachedTokens: Map<string, BrowserSessionTokenInfo> | null = null;
  private sessionState: BrowserSessionState | null = null;

  async createSession(payload: CreateSessionPayload): Promise<{ ok: true; proxyToken: string }> {
    const proxyToken = generateProxyToken();
    const tokenInfo: BrowserSessionTokenInfo = {
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId,
    };

    const tokenMap: Record<string, BrowserSessionTokenInfo> = { [proxyToken]: tokenInfo };
    await this.ctx.storage.put('proxyTokens', tokenMap);
    this.cachedTokens = new Map(Object.entries(tokenMap));

    this.sessionState = {
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId,
      status: 'starting',
      createdAt: new Date().toISOString(),
    };

    await this.startAndWaitForPorts([8080]);
    this.sessionState.status = 'active';
    return { ok: true, proxyToken };
  }

  async verifyProxyToken(token: string): Promise<BrowserSessionTokenInfo | null> {
    if (!this.cachedTokens) {
      const stored = await this.ctx.storage.get<Record<string, BrowserSessionTokenInfo>>('proxyTokens');
      if (!stored) return null;
      this.cachedTokens = new Map(Object.entries(stored));
    }
    for (const [storedToken, info] of this.cachedTokens) {
      if (constantTimeEqual(token, storedToken)) return info;
    }
    return null;
  }

  async getSessionState(): Promise<BrowserSessionState | null> {
    return this.sessionState;
  }

  async destroySession(): Promise<void> {
    if (this.sessionState) this.sessionState.status = 'stopped';
    this.cachedTokens = null;
    await this.ctx.storage.delete('proxyTokens');
    await this.destroy();
  }

  /** Forward an HTTP request to the container. */
  async forwardToContainer(path: string, init?: RequestInit): Promise<Response> {
    this.renewActivityTimeout();
    const tcpPort = (this as unknown as HostContainerInternals).container.getTcpPort(8080);
    const request = new Request(`http://internal${path}`, init);
    return tcpPort.fetch(request.url, request);
  }

  /** Handle fetch — for WebSocket (VNC) upgrade. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/vnc' && request.headers.get('Upgrade') === 'websocket') {
      this.renewActivityTimeout();
      const tcpPort = (this as unknown as HostContainerInternals).container.getTcpPort(8080);
      const containerRequest = new Request('http://internal/vnc', { headers: request.headers });
      return tcpPort.fetch(containerRequest.url, containerRequest);
    }
    return new Response('Not Found', { status: 404 });
  }
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

function getDOStub(env: Env, sessionId: string): DurableObjectStub & BrowserSessionContainer {
  const id = env.BROWSER_CONTAINER.idFromName(sessionId);
  return env.BROWSER_CONTAINER.get(id) as unknown as DurableObjectStub & BrowserSessionContainer;
}

function errorResponse(c: { json: (data: unknown, status: number) => Response }, err: unknown): Response {
  return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
}

// Health
app.get('/health', (c) => c.json({ status: 'ok', service: 'takos-browser-host' }));

// ---------------------------------------------------------------------------
// GUI
// ---------------------------------------------------------------------------

app.get('/gui', (c) => new Response(dashboardHtml, {
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
}));

app.get('/gui/viewer/:id', (c) => {
  const html = viewerHtml.replace('{{SESSION_ID}}', c.req.param('id').replace(/'/g, "\\'"));
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});

app.get('/gui/style.css', () => new Response(styleCss, {
  headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
}));

app.get('/gui/api/sessions', async (c) => {
  const kv = c.env.SESSION_INDEX;
  if (!kv) return c.json({ sessions: [] });
  const list = await kv.list({ prefix: 'session:' });
  const sessions: BrowserSessionState[] = [];
  for (const key of list.keys) {
    const val = await kv.get(key.name, { type: 'json' }) as BrowserSessionState | null;
    if (val) sessions.push(val);
  }
  return c.json({ sessions });
});

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

app.post('/create', async (c) => {
  const payload = await c.req.json<CreateSessionPayload>();
  if (!payload.sessionId || !payload.spaceId || !payload.userId) {
    return c.json({ error: 'Missing required fields: sessionId, spaceId, userId' }, 400);
  }
  try {
    const stub = getDOStub(c.env, payload.sessionId);
    const result = await stub.createSession(payload);
    const kv = c.env.SESSION_INDEX;
    if (kv) {
      const state: BrowserSessionState = {
        sessionId: payload.sessionId, spaceId: payload.spaceId, userId: payload.userId,
        status: 'active', createdAt: new Date().toISOString(),
      };
      await kv.put(`session:${payload.sessionId}`, JSON.stringify(state));
    }
    return c.json(result, 201);
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.get('/session/:id', async (c) => {
  const stub = getDOStub(c.env, c.req.param('id'));
  const state = await stub.getSessionState();
  if (!state) return c.json({ error: 'Session not found' }, 404);
  return c.json(state);
});

app.delete('/session/:id', async (c) => {
  const sessionId = c.req.param('id');
  const stub = getDOStub(c.env, sessionId);
  try {
    await stub.destroySession();
    const kv = c.env.SESSION_INDEX;
    if (kv) await kv.delete(`session:${sessionId}`);
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
});

// ---------------------------------------------------------------------------
// MCP — forward to container (sole API surface for tools)
// ---------------------------------------------------------------------------

app.post('/session/:id/mcp', async (c) => {
  const stub = getDOStub(c.env, c.req.param('id'));
  try {
    const response = await stub.forwardToContainer('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await c.req.json()),
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    return errorResponse(c, err);
  }
});

// ---------------------------------------------------------------------------
// VNC WebSocket — forward upgrade to DO → container
// ---------------------------------------------------------------------------

app.get('/session/:id/vnc', async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426);
  }
  const id = c.env.BROWSER_CONTAINER.idFromName(c.req.param('id'));
  const doStub = c.env.BROWSER_CONTAINER.get(id);
  const url = new URL(c.req.raw.url);
  url.pathname = '/vnc';
  return (doStub as { fetch(input: string, init?: RequestInit): Promise<Response> }).fetch(
    url.toString(),
    { headers: Object.fromEntries(c.req.raw.headers.entries()) },
  );
});

export default {
  fetch: app.fetch,
};
