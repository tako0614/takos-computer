import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createLogger } from '@takos-computer/common/logger';
import { BrowserManager } from './browser-manager.js';
import { DisplayManager } from './display-manager.js';
import { ProcessManager } from './process-manager.js';
import { createVncProxy } from './vnc-proxy.js';

export type BrowserServiceOptions = {
  port?: number;
  shutdownGraceMs?: number;
  serviceName?: string;
};

export function createBrowserServiceApp(options: BrowserServiceOptions = {}) {
  const logger = createLogger({ service: options.serviceName ?? 'browserd' });
  const browser = new BrowserManager();
  const display = new DisplayManager();
  const processes = new ProcessManager();
  const app = new Hono();

  // Health check — used by CF Containers for readiness probe
  app.get('/healthz', (c) => c.json({
    status: 'ok',
    service: options.serviceName ?? 'browserd',
    browser_alive: browser.isAlive(),
    display: Boolean(process.env.DISPLAY),
  }));

  // MCP endpoint — the sole public API surface.
  // All browser, display, and process tools are exposed here.
  let mcpHandler: ((request: Request) => Promise<Response>) | null = null;
  app.post('/mcp', async (c) => {
    if (!mcpHandler) {
      const { createBrowserMcpServer, createMcpRequestHandler } = await import('./mcp.js');
      const mcpServer = createBrowserMcpServer({
        browser,
        display: process.env.DISPLAY ? display : undefined,
        processes: process.env.DISPLAY ? processes : undefined,
      });
      mcpHandler = createMcpRequestHandler(mcpServer, process.env.MCP_AUTH_TOKEN || undefined);
    }
    return mcpHandler(c.req.raw);
  });

  app.onError((err, c) => {
    logger.error('Request error', { error: err });
    return c.json({ error: err.message }, 500);
  });

  return { app, browser, processes, logger };
}

export function startBrowserService(options: BrowserServiceOptions = {}) {
  const port = options.port ?? parseInt(process.env.PORT ?? '8080', 10);
  const shutdownGraceMs = options.shutdownGraceMs ?? parseInt(process.env.SHUTDOWN_GRACE_MS ?? '15000', 10);
  const { app, browser, processes, logger } = createBrowserServiceApp(options);
  const server = serve({ fetch: app.fetch, port }, () => {
    logger.info(`[browserd] Listening on port ${port}`);
  });

  // Attach WebSocket-to-VNC proxy for GUI remote access
  if (process.env.DISPLAY) {
    createVncProxy(server, logger);
  }

  async function shutdown(signal: string): Promise<void> {
    logger.info(`[browserd] Received ${signal}, shutting down`);
    processes.killAll();
    await browser.close();
    server.close(() => {
      logger.info('[browserd] Server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn(`[browserd] Force exit after ${shutdownGraceMs}ms`);
      process.exit(1);
    }, shutdownGraceMs).unref();
  }

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });

  return { app, browser, server, logger };
}
