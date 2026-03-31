import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { spy, assertSpyCalls } from 'jsr:@std/testing/mock';

// NOTE: This test file previously used vi.mock() for workspace dependencies.
// In Deno, module mocking is not directly supported. The tests are adapted
// to work without module-level mocking where possible.

import {
  buildExecutorRuntimeConfig,
  hasControlRpcConfiguration,
  buildRuntimeStartPayload,
  createExecutorApp,
} from '../executor-app.ts';
import { createConcurrencyGuard } from '@takos-computer/agent-core/executor-utils';

// ---------------------------------------------------------------------------
// buildExecutorRuntimeConfig
// ---------------------------------------------------------------------------

Deno.test('buildExecutorRuntimeConfig - builds config from environment variables', () => {
  const config = buildExecutorRuntimeConfig({
    CONTROL_RPC_BASE_URL: 'https://control.example.com',
    ADMIN_DOMAIN: 'admin.takos.dev',
    TENANT_BASE_DOMAIN: 'app.takos.dev',
    MAX_AGENT_ITERATIONS: '50',
    AGENT_TEMPERATURE: '0.7',
    AGENT_RATE_LIMIT: '10',
    AGENT_ITERATION_TIMEOUT: '120000',
    AGENT_TOTAL_TIMEOUT: '3600000',
    TOOL_EXECUTION_TIMEOUT: '300000',
    LANGGRAPH_TIMEOUT: '86400000',
    SERPER_API_KEY: 'sk-serper',
  });

  assertEquals(config.controlRpcBaseUrl, 'https://control.example.com');
  assertEquals(config.executionEnv?.ADMIN_DOMAIN, 'admin.takos.dev');
  assertEquals(config.executionEnv?.TENANT_BASE_DOMAIN, 'app.takos.dev');
  assertEquals(config.executionEnv?.MAX_AGENT_ITERATIONS, '50');
  assertEquals(config.executionEnv?.AGENT_TEMPERATURE, '0.7');
  assertEquals(config.executionEnv?.AGENT_RATE_LIMIT, '10');
  assertEquals(config.executionEnv?.AGENT_ITERATION_TIMEOUT, '120000');
  assertEquals(config.executionEnv?.AGENT_TOTAL_TIMEOUT, '3600000');
  assertEquals(config.executionEnv?.TOOL_EXECUTION_TIMEOUT, '300000');
  assertEquals(config.executionEnv?.LANGGRAPH_TIMEOUT, '86400000');
  assertEquals(config.executionEnv?.SERPER_API_KEY, 'sk-serper');
  assertEquals(config.maxRunDurationMs, 3600000);
});

Deno.test('buildExecutorRuntimeConfig - handles missing environment variables', () => {
  const config = buildExecutorRuntimeConfig({});

  assertEquals(config.controlRpcBaseUrl, undefined);
  assertEquals(config.executionEnv?.ADMIN_DOMAIN, undefined);
  assertEquals(config.allowNoLlmFallback, false);
  assertEquals(config.maxRunDurationMs, undefined);
});

Deno.test('buildExecutorRuntimeConfig - parses allowNoLlmFallback from TAKOS_ALLOW_NO_LLM', () => {
  assertEquals(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: 'true' }).allowNoLlmFallback, true);
  assertEquals(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: '1' }).allowNoLlmFallback, true);
  assertEquals(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: 'yes' }).allowNoLlmFallback, true);
  assertEquals(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: 'on' }).allowNoLlmFallback, true);
  assertEquals(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: 'false' }).allowNoLlmFallback, false);
  assertEquals(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: '0' }).allowNoLlmFallback, false);
  assertEquals(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: '' }).allowNoLlmFallback, false);
});

Deno.test('buildExecutorRuntimeConfig - falls back to TAKOS_LOCAL_ALLOW_NO_LLM', () => {
  assertEquals(buildExecutorRuntimeConfig({ TAKOS_LOCAL_ALLOW_NO_LLM: 'true' }).allowNoLlmFallback, true);
});

Deno.test('buildExecutorRuntimeConfig - prefers TAKOS_ALLOW_NO_LLM over TAKOS_LOCAL_ALLOW_NO_LLM', () => {
  assertEquals(buildExecutorRuntimeConfig({
    TAKOS_ALLOW_NO_LLM: 'false',
    TAKOS_LOCAL_ALLOW_NO_LLM: 'true',
  }).allowNoLlmFallback, false);
});

Deno.test('buildExecutorRuntimeConfig - handles non-numeric AGENT_TOTAL_TIMEOUT', () => {
  const config = buildExecutorRuntimeConfig({ AGENT_TOTAL_TIMEOUT: 'not-a-number' });
  assertEquals(config.maxRunDurationMs, undefined);
});

Deno.test('buildExecutorRuntimeConfig - handles boolean env values with whitespace', () => {
  assertEquals(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: ' TRUE ' }).allowNoLlmFallback, true);
  assertEquals(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: ' Yes ' }).allowNoLlmFallback, true);
});

// ---------------------------------------------------------------------------
// hasControlRpcConfiguration
// ---------------------------------------------------------------------------

Deno.test('hasControlRpcConfiguration - returns true when controlRpcBaseUrl is set', () => {
  assertEquals(hasControlRpcConfiguration({ controlRpcBaseUrl: 'https://control.example.com' }), true);
});

Deno.test('hasControlRpcConfiguration - returns false when controlRpcBaseUrl is undefined', () => {
  assertEquals(hasControlRpcConfiguration({}), false);
});

Deno.test('hasControlRpcConfiguration - returns false when controlRpcBaseUrl is empty string', () => {
  assertEquals(hasControlRpcConfiguration({ controlRpcBaseUrl: '' }), false);
});

// ---------------------------------------------------------------------------
// buildRuntimeStartPayload
// ---------------------------------------------------------------------------

Deno.test('buildRuntimeStartPayload - merges payload with runtime config base URL', () => {
  const payload = {
    runId: 'run-1',
    workerId: 'w-1',
    controlRpcToken: 'tok',
  };
  const config = { controlRpcBaseUrl: 'https://control.example.com' };

  const result = buildRuntimeStartPayload(payload, config);
  assertEquals(result.controlRpcBaseUrl, 'https://control.example.com');
  assertEquals(result.runId, 'run-1');
  assertEquals(result.workerId, 'w-1');
  assertEquals(result.controlRpcToken, 'tok');
});

Deno.test('buildRuntimeStartPayload - attaches shutdown signal', () => {
  const controller = new AbortController();
  const payload = { runId: 'run-1', workerId: 'w-1' };
  const config = {};

  const result = buildRuntimeStartPayload(payload, config, controller.signal);
  assertEquals(result.shutdownSignal, controller.signal);
});

Deno.test('buildRuntimeStartPayload - preserves original payload fields', () => {
  const payload = {
    runId: 'run-1',
    workerId: 'w-1',
    model: 'gpt-4',
    leaseVersion: 3,
    controlRpcToken: 'tok',
    controlRpcBaseUrl: 'https://original.example.com',
  };
  const config = { controlRpcBaseUrl: 'https://override.example.com' };

  const result = buildRuntimeStartPayload(payload, config);
  assertEquals(result.controlRpcBaseUrl, 'https://override.example.com');
  assertEquals(result.model, 'gpt-4');
  assertEquals(result.leaseVersion, 3);
});

// ---------------------------------------------------------------------------
// createExecutorApp - HTTP endpoint tests
// ---------------------------------------------------------------------------

function createApp(overrides: {
  executeRunInContainer?: (payload: unknown) => Promise<void>;
  concurrency?: ReturnType<typeof createConcurrencyGuard>;
  runtimeConfig?: ReturnType<typeof buildExecutorRuntimeConfig>;
} = {}) {
  const mockLogger = { info: spy(), warn: spy(), error: spy() };
  const config = overrides.runtimeConfig ?? buildExecutorRuntimeConfig({
    CONTROL_RPC_BASE_URL: 'https://control.example.com',
  });
  return {
    app: createExecutorApp({
      executeRunInContainer: overrides.executeRunInContainer ?? spy(async () => undefined),
      logger: mockLogger,
      concurrency: overrides.concurrency,
      runtimeConfig: config,
    }),
    logger: mockLogger,
  };
}

Deno.test('createExecutorApp - GET /health returns status ok with concurrency info', async () => {
  const concurrency = createConcurrencyGuard(5);
  const { app } = createApp({ concurrency });

  const req = new Request('http://localhost/health');
  const res = await app.fetch(req);
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.status, 'ok');
  assertEquals(body.runs.active, 0);
  assertEquals(body.runs.max, 5);
  assertEquals(body.runs.available, 5);
});

Deno.test('createExecutorApp - GET /health reflects active runs after acquire', async () => {
  const concurrency = createConcurrencyGuard(3);
  concurrency.tryAcquire();
  concurrency.tryAcquire();
  const { app } = createApp({ concurrency });

  const req = new Request('http://localhost/health');
  const res = await app.fetch(req);
  const body = await res.json();
  assertEquals(body.runs.active, 2);
  assertEquals(body.runs.available, 1);
});

Deno.test('createExecutorApp - POST /start returns 400 for malformed JSON', async () => {
  const { app } = createApp();
  const req = new Request('http://localhost/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'Malformed JSON body');
});

Deno.test('createExecutorApp - POST /start returns 400 for invalid payload', async () => {
  const { app } = createApp();
  const req = new Request('http://localhost/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertStringIncludes(body.error, 'Missing required field');
});

Deno.test('createExecutorApp - POST /start returns 503 when at capacity', async () => {
  const concurrency = createConcurrencyGuard(1);
  concurrency.tryAcquire(); // fill capacity
  const { app } = createApp({ concurrency });

  const req = new Request('http://localhost/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: 'run-1',
      workerId: 'w-1',
      controlRpcToken: 'tok',
    }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.error, 'At capacity');
});

Deno.test('createExecutorApp - POST /start returns 503 when CONTROL_RPC_BASE_URL is not configured', async () => {
  const config = buildExecutorRuntimeConfig({});
  const { app } = createApp({ runtimeConfig: config });

  const req = new Request('http://localhost/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: 'run-1',
      workerId: 'w-1',
      controlRpcToken: 'tok',
    }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.error, 'CONTROL_RPC_BASE_URL not configured');
});

Deno.test('createExecutorApp - POST /start returns 202 for valid payload', async () => {
  const executeRunInContainer = spy(async () => undefined);
  const { app } = createApp({ executeRunInContainer });

  const req = new Request('http://localhost/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: 'run-1',
      workerId: 'w-1',
      controlRpcToken: 'tok',
    }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 202);
  const body = await res.json();
  assertEquals(body.status, 'accepted');
  assertEquals(body.runId, 'run-1');
});

Deno.test('createExecutorApp - releases concurrency slot after executeRunInContainer completes', async () => {
  let resolveRun: () => void;
  const runPromise = new Promise<void>((resolve) => { resolveRun = resolve; });
  const executeRunInContainer = spy(() => runPromise);
  const concurrency = createConcurrencyGuard(2);
  const { app } = createApp({ executeRunInContainer: executeRunInContainer as unknown as (payload: unknown) => Promise<void>, concurrency });

  const req = new Request('http://localhost/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: 'run-1',
      workerId: 'w-1',
      controlRpcToken: 'tok',
    }),
  });
  await app.fetch(req);

  assertEquals(concurrency.activeRuns, 1);

  resolveRun!();
  // Allow microtask to complete
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(concurrency.activeRuns, 0);
});

Deno.test('createExecutorApp - releases concurrency slot when executeRunInContainer throws', async () => {
  const executeRunInContainer = spy(async () => { throw new Error('boom'); });
  const concurrency = createConcurrencyGuard(2);
  const { app } = createApp({ executeRunInContainer: executeRunInContainer as unknown as (payload: unknown) => Promise<void>, concurrency });

  const req = new Request('http://localhost/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: 'run-1',
      workerId: 'w-1',
      controlRpcToken: 'tok',
    }),
  });
  await app.fetch(req);

  // Allow microtask to complete
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(concurrency.activeRuns, 0);
});

Deno.test('createExecutorApp - logs error when executeRunInContainer throws', async () => {
  const executeRunInContainer = spy(async () => { throw new Error('agent-crash'); });
  const { app, logger } = createApp({ executeRunInContainer: executeRunInContainer as unknown as (payload: unknown) => Promise<void> });

  const req = new Request('http://localhost/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: 'run-1',
      workerId: 'w-1',
      controlRpcToken: 'tok',
    }),
  });
  await app.fetch(req);

  // Allow the fire-and-forget promise to settle
  await new Promise((resolve) => setTimeout(resolve, 10));
  const errorCalls = logger.error.calls.map((c: { args: unknown[] }) => c.args[0] as string);
  assert(errorCalls.some((msg: string) => msg.includes('Unhandled error for run run-1')));
});
