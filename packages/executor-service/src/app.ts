import { createLogger } from '@takos-computer/common/logger';
import { executeRunInContainer as sharedExecuteRun } from '@takos-computer/agent-core/run-executor';
import type { StartPayload } from '@takos-computer/agent-core/run-executor';
import {
  createConcurrencyGuard,
  installGracefulShutdown,
  type ConcurrencyGuard,
} from '@takos-computer/agent-core/executor-utils';
import { executeRun } from '@takos-computer/computer-agent/agent-runner';
import {
  buildExecutorRuntimeConfig,
  createExecutorApp,
  hasControlRpcConfiguration,
} from './executor-app.ts';

export type ExecutorServiceOptions = {
  port?: number;
  maxConcurrentRuns?: number;
  shutdownGraceMs?: number;
  serviceName?: string;
  concurrency?: ConcurrencyGuard;
};

export function createExecutorServiceApp(options: ExecutorServiceOptions = {}) {
  const serviceName = options.serviceName ?? 'takos-executor';
  const logger = createLogger({ service: serviceName });
  const runtimeConfig = buildExecutorRuntimeConfig(Deno.env.toObject());
  const concurrency = options.concurrency ?? createConcurrencyGuard(
    options.maxConcurrentRuns ?? parseInt(Deno.env.get('MAX_CONCURRENT_RUNS') ?? '5', 10),
  );
  const shutdownController = new AbortController();

  async function executeRunInContainer(payload: StartPayload): Promise<void> {
    return sharedExecuteRun(payload, {
      serviceName,
      logger,
      executeRun,
      runtimeConfig,
    });
  }

  const app = createExecutorApp({
    executeRunInContainer,
    logger,
    concurrency,
    shutdownSignal: shutdownController.signal,
    runtimeConfig,
  });

  return { app, logger, concurrency, shutdownController, runtimeConfig };
}

export function startExecutorService(options: ExecutorServiceOptions = {}) {
  const port = options.port ?? parseInt(Deno.env.get('PORT') ?? '8080', 10);
  const gracePeriodMs = options.shutdownGraceMs ?? parseInt(Deno.env.get('SHUTDOWN_GRACE_MS') ?? '30000', 10);
  const { app, logger, concurrency, shutdownController, runtimeConfig } = createExecutorServiceApp(options);

  const abortController = new AbortController();
  const server = Deno.serve({ port, signal: abortController.signal }, app.fetch);
  logger.info(`[executor] Listening on port ${port}`);
  const controlRpcConfiguredAtStartup = hasControlRpcConfiguration(runtimeConfig);
  logger.info(`[executor] Control RPC configured at startup: ${controlRpcConfiguredAtStartup}`);
  if (!controlRpcConfiguredAtStartup) {
    logger.warn('[executor] CONTROL_RPC_BASE_URL env missing at startup; /start will return 503 until configured');
  }

  installGracefulShutdown({
    serviceName: options.serviceName ?? 'takos-executor',
    logger,
    shutdownController,
    concurrency,
    server: { close: (cb?: () => void) => { abortController.abort(); server.finished.then(cb); } },
    gracePeriodMs,
  });

  return { app, server, logger, concurrency };
}
