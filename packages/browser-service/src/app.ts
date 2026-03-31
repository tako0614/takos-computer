import { Hono } from 'hono';
import { createLogger } from '@takos-computer/common/logger';
import { BrowserManager } from './browser-manager.ts';
import { DisplayManager } from './display-manager.ts';
import { ProcessManager } from './process-manager.ts';
import { createVncProxy } from './vnc-proxy.ts';

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
    display: Boolean(Deno.env.get('DISPLAY')),
  }));

  // MCP endpoint — the sole public API surface.
  // All browser, display, and process tools are exposed here.
  let mcpHandler: ((request: Request) => Promise<Response>) | null = null;
  app.post('/mcp', async (c) => {
    if (!mcpHandler) {
      const { createBrowserMcpServer, createMcpRequestHandler } = await import('./mcp.ts');
      const mcpServer = createBrowserMcpServer({
        browser,
        display: Deno.env.get('DISPLAY') ? display : undefined,
        processes: Deno.env.get('DISPLAY') ? processes : undefined,
      });
      mcpHandler = createMcpRequestHandler(mcpServer, Deno.env.get('MCP_AUTH_TOKEN') || undefined);
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
  const port = options.port ?? parseInt(Deno.env.get('PORT') ?? '8080', 10);
  const shutdownGraceMs = options.shutdownGraceMs ?? parseInt(Deno.env.get('SHUTDOWN_GRACE_MS') ?? '15000', 10);
  const { app, browser, processes, logger } = createBrowserServiceApp(options);

  const abortController = new AbortController();
  const server = Deno.serve({ port, signal: abortController.signal }, app.fetch);
  logger.info(`[browserd] Listening on port ${port}`);

  // TODO: VNC proxy needs Deno WebSocket upgrade support
  // if (Deno.env.get('DISPLAY')) {
  //   createVncProxy(server, logger);
  // }

  async function shutdown(signal: string): Promise<void> {
    logger.info(`[browserd] Received ${signal}, shutting down`);
    processes.killAll();
    await browser.close();
    abortController.abort();
    await server.finished;
    logger.info('[browserd] Server closed');
    Deno.exit(0);
  }

  const forceExit = () => {
    setTimeout(() => {
      logger.warn(`[browserd] Force exit after ${shutdownGraceMs}ms`);
      Deno.exit(1);
    }, shutdownGraceMs);
  };

  Deno.addSignalListener('SIGTERM', () => { forceExit(); void shutdown('SIGTERM'); });
  Deno.addSignalListener('SIGINT', () => { forceExit(); void shutdown('SIGINT'); });

  return { app, browser, server, logger };
}
