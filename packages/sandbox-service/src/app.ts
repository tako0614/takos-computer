import { Hono } from "hono";
import process from "node:process";
import { createLogger } from "@takos-computer/common/logger";
import { ShellManager } from "./shell-manager.ts";
import { FsManager } from "./fs-manager.ts";

export type SandboxServiceOptions = {
  port?: number;
  shutdownGraceMs?: number;
  serviceName?: string;
  workspaceRoot?: string;
  mcpAuthToken?: string | null;
  allowUnauthenticatedMcp?: boolean;
};

type BunServer = {
  stop(closeActiveConnections?: boolean): void;
};

type BunLike = {
  serve(options: {
    port: number;
    fetch: (request: Request) => Response | Promise<Response>;
  }): BunServer;
};

function bunLike(): BunLike {
  const bun = (globalThis as { Bun?: BunLike }).Bun;
  if (!bun) throw new Error("Bun runtime is required to start sandbox service");
  return bun;
}

export function createSandboxServiceApp(options: SandboxServiceOptions = {}): {
  app: Hono;
  shell: ShellManager;
  fs: FsManager;
  logger: ReturnType<typeof createLogger>;
} {
  const logger = createLogger({ service: options.serviceName ?? "sandbox" });
  const shell = new ShellManager(options.workspaceRoot);
  const fs = new FsManager(options.workspaceRoot);
  const app = new Hono();
  const mcpAuthToken = options.mcpAuthToken === null
    ? undefined
    : options.mcpAuthToken ?? process.env.MCP_AUTH_TOKEN ?? undefined;
  const allowUnauthenticatedMcp = options.allowUnauthenticatedMcp ??
    process.env.MCP_ALLOW_UNAUTHENTICATED === "true";

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
  server: BunServer;
  logger: ReturnType<typeof createLogger>;
} {
  const port = options.port ?? parseInt(process.env.PORT ?? "8080", 10);
  const shutdownGraceMs = options.shutdownGraceMs ??
    parseInt(process.env.SHUTDOWN_GRACE_MS ?? "15000", 10);
  const { app, logger } = createSandboxServiceApp(options);

  const server = bunLike().serve({
    port,
    fetch: (request) => app.fetch(request),
  });
  logger.info(`[sandbox] Listening on port ${port}`);

  async function shutdown(signal: string): Promise<void> {
    logger.info(`[sandbox] Received ${signal}, shutting down`);
    server.stop(false);
    logger.info("[sandbox] Server closed");
    process.exit(0);
  }

  const forceExit = () => {
    setTimeout(() => {
      logger.warn(`[sandbox] Force exit after ${shutdownGraceMs}ms`);
      process.exit(1);
    }, shutdownGraceMs);
  };

  process.on("SIGTERM", () => {
    forceExit();
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    forceExit();
    void shutdown("SIGINT");
  });

  return { app, server, logger };
}
