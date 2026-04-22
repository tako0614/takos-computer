import { Hono } from "hono";
import { createLogger } from "@takos-computer/common/logger";
import { ShellManager } from "./shell-manager.ts";
import { FsManager } from "./fs-manager.ts";

export type SandboxServiceOptions = {
  port?: number;
  shutdownGraceMs?: number;
  serviceName?: string;
  mcpAuthToken?: string | null;
  allowUnauthenticatedMcp?: boolean;
};

export function createSandboxServiceApp(options: SandboxServiceOptions = {}): {
  app: Hono;
  shell: ShellManager;
  fs: FsManager;
  logger: ReturnType<typeof createLogger>;
} {
  const logger = createLogger({ service: options.serviceName ?? "sandbox" });
  const shell = new ShellManager();
  const fs = new FsManager();
  const app = new Hono();
  const mcpAuthToken = options.mcpAuthToken === null
    ? undefined
    : options.mcpAuthToken ?? Deno.env.get("MCP_AUTH_TOKEN") ?? undefined;
  const allowUnauthenticatedMcp = options.allowUnauthenticatedMcp ??
    Deno.env.get("MCP_ALLOW_UNAUTHENTICATED") === "true";

  app.get("/healthz", (c) =>
    c.json({
      status: "ok",
      service: options.serviceName ?? "sandbox",
    }));

  // MCP endpoint — the sole public API surface.
  // All shell, filesystem, and process tools are exposed here.
  let mcpHandler: ((request: Request) => Promise<Response>) | null = null;
  app.all("/mcp", async (c) => {
    if (!mcpHandler) {
      const { createMcpRequestHandler } = await import("./mcp.ts");
      mcpHandler = createMcpRequestHandler(
        { shell, fs },
        mcpAuthToken,
        { allowUnauthenticated: allowUnauthenticatedMcp },
      );
    }
    return mcpHandler(c.req.raw);
  });

  app.onError((err, c) => {
    logger.error("Request error", { error: err });
    return c.json({ error: err.message }, 500);
  });

  return { app, shell, fs, logger };
}

export function startSandboxService(options: SandboxServiceOptions = {}): {
  app: Hono;
  server: Deno.HttpServer;
  logger: ReturnType<typeof createLogger>;
} {
  const port = options.port ?? parseInt(Deno.env.get("PORT") ?? "8080", 10);
  const shutdownGraceMs = options.shutdownGraceMs ??
    parseInt(Deno.env.get("SHUTDOWN_GRACE_MS") ?? "15000", 10);
  const { app, logger } = createSandboxServiceApp(options);

  const abortController = new AbortController();
  const server = Deno.serve(
    { port, signal: abortController.signal },
    app.fetch,
  );
  logger.info(`[sandbox] Listening on port ${port}`);

  async function shutdown(signal: string): Promise<void> {
    logger.info(`[sandbox] Received ${signal}, shutting down`);
    abortController.abort();
    await server.finished;
    logger.info("[sandbox] Server closed");
    Deno.exit(0);
  }

  const forceExit = () => {
    setTimeout(() => {
      logger.warn(`[sandbox] Force exit after ${shutdownGraceMs}ms`);
      Deno.exit(1);
    }, shutdownGraceMs);
  };

  Deno.addSignalListener("SIGTERM", () => {
    forceExit();
    void shutdown("SIGTERM");
  });
  Deno.addSignalListener("SIGINT", () => {
    forceExit();
    void shutdown("SIGINT");
  });

  return { app, server, logger };
}
