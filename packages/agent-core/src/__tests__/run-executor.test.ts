import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { spy, assertSpyCalls } from 'jsr:@std/testing/mock';
import { shouldResetRunToQueuedOnContainerError } from '../run-executor.ts';
import type { RunStatus } from '../run-executor.ts';

// ---------------------------------------------------------------------------
// shouldResetRunToQueuedOnContainerError
// ---------------------------------------------------------------------------

Deno.test('shouldResetRunToQueuedOnContainerError - returns true for "running" status', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError('running'), true);
});

Deno.test('shouldResetRunToQueuedOnContainerError - returns false for "completed" status', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError('completed'), false);
});

Deno.test('shouldResetRunToQueuedOnContainerError - returns false for "failed" status', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError('failed'), false);
});

Deno.test('shouldResetRunToQueuedOnContainerError - returns false for "cancelled" status', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError('cancelled'), false);
});

Deno.test('shouldResetRunToQueuedOnContainerError - returns false for "pending" status', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError('pending'), false);
});

Deno.test('shouldResetRunToQueuedOnContainerError - returns false for "queued" status', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError('queued'), false);
});

Deno.test('shouldResetRunToQueuedOnContainerError - returns false for null', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError(null), false);
});

Deno.test('shouldResetRunToQueuedOnContainerError - returns false for undefined', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError(undefined), false);
});

// ---------------------------------------------------------------------------
// executeRunInContainer - integration-style tests with mocked fetch
// ---------------------------------------------------------------------------

function createMockLogger() {
  return {
    info: spy(),
    warn: spy(),
    error: spy(),
  };
}

function mockFetchSequence(
  fetchSpy: { calls: Array<{ args: unknown[] }> },
  responses: Array<{ path: string; body: unknown; status?: number }>,
) {
  let callIndex = 0;
  return (input: unknown) => {
    const expectedResponse = responses[callIndex];
    callIndex++;
    if (!expectedResponse) {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify(expectedResponse.body),
        { status: expectedResponse.status ?? 200 },
      ),
    );
  };
}

Deno.test('executeRunInContainer - throws when controlRpcToken is missing', async () => {
  const mockLogger = createMockLogger();
  const originalFetch = globalThis.fetch;
  const fetchSpy = spy();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  try {
    const { executeRunInContainer } = await import('../run-executor.ts');
    await assertRejects(
      () =>
        executeRunInContainer(
          { runId: 'r-1', workerId: 'w-1' },
          {
            serviceName: 'test',
            logger: mockLogger,
            executeRun: spy(),
          },
        ),
      Error,
      'Missing control RPC token',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('executeRunInContainer - throws when controlRpcBaseUrl is missing', async () => {
  const mockLogger = createMockLogger();
  const originalFetch = globalThis.fetch;
  const fetchSpy = spy();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  try {
    const { executeRunInContainer } = await import('../run-executor.ts');
    await assertRejects(
      () =>
        executeRunInContainer(
          { runId: 'r-1', workerId: 'w-1', controlRpcToken: 'tok' },
          {
            serviceName: 'test',
            logger: mockLogger,
            executeRun: spy(),
          },
        ),
      Error,
      'Missing CONTROL_RPC_BASE_URL',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('executeRunInContainer - resets run and throws when no API keys are available', async () => {
  const mockLogger = createMockLogger();
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const responses = [
    { path: '/rpc/control/api-keys', body: { openai: null, anthropic: null, google: null } },
    { path: '/rpc/control/run-reset', body: {} },
  ];
  globalThis.fetch = ((_input: unknown) => {
    const expectedResponse = responses[callIndex];
    callIndex++;
    if (!expectedResponse) {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(expectedResponse.body), { status: expectedResponse.status ?? 200 }),
    );
  }) as typeof fetch;
  try {
    const { executeRunInContainer } = await import('../run-executor.ts');
    await assertRejects(
      () =>
        executeRunInContainer(
          {
            runId: 'r-1',
            workerId: 'w-1',
            controlRpcToken: 'tok',
            controlRpcBaseUrl: 'https://control.example.com',
          },
          {
            serviceName: 'test',
            logger: mockLogger,
            executeRun: spy(),
          },
        ),
      Error,
      'No LLM API keys available',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('executeRunInContainer - invokes no-LLM fast path when allowNoLlmFallback is true', async () => {
  const mockLogger = createMockLogger();
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const fetchCalls: string[] = [];
  const responses = [
    { path: '/rpc/control/api-keys', body: { openai: null, anthropic: null, google: null } },
    { path: '/rpc/control/run-context', body: { lastUserMessage: 'hello' } },
    { path: '/rpc/control/no-llm-complete', body: {} },
  ];
  globalThis.fetch = ((input: unknown) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    fetchCalls.push(url);
    const expectedResponse = responses[callIndex];
    callIndex++;
    if (!expectedResponse) {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(expectedResponse.body), { status: expectedResponse.status ?? 200 }),
    );
  }) as typeof fetch;
  try {
    const { executeRunInContainer } = await import('../run-executor.ts');
    await executeRunInContainer(
      {
        runId: 'r-1',
        workerId: 'w-1',
        controlRpcToken: 'tok',
        controlRpcBaseUrl: 'https://control.example.com',
      },
      {
        serviceName: 'test',
        logger: mockLogger,
        executeRun: spy(),
        runtimeConfig: {
          allowNoLlmFallback: true,
        },
      },
    );

    // Should have called no-llm-complete
    assertEquals(fetchCalls.some((u: string) => u.includes('/rpc/control/no-llm-complete')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('executeRunInContainer - calls executeRun and records billing on success', async () => {
  const mockLogger = createMockLogger();
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const responses = [
    { path: '/rpc/control/api-keys', body: { openai: 'sk-test', anthropic: null, google: null } },
    { path: '/rpc/control/billing-run-usage', body: {} },
  ];
  globalThis.fetch = ((_input: unknown) => {
    const expectedResponse = responses[callIndex];
    callIndex++;
    if (!expectedResponse) {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(expectedResponse.body), { status: expectedResponse.status ?? 200 }),
    );
  }) as typeof fetch;

  const executeRun = spy(async () => undefined);
  try {
    const { executeRunInContainer } = await import('../run-executor.ts');
    await executeRunInContainer(
      {
        runId: 'r-1',
        workerId: 'w-1',
        controlRpcToken: 'tok',
        controlRpcBaseUrl: 'https://control.example.com',
      },
      {
        serviceName: 'test',
        logger: mockLogger,
        executeRun,
        runtimeConfig: {
          maxRunDurationMs: 60000,
        },
      },
    );

    assertSpyCalls(executeRun, 1);
    const [env, apiKey, runId] = executeRun.calls[0].args;
    assertEquals((env as Record<string, string>).OPENAI_API_KEY, 'sk-test');
    assertEquals(apiKey, 'sk-test');
    assertEquals(runId, 'r-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('executeRunInContainer - resets run when executeRun fails and status is running', async () => {
  const mockLogger = createMockLogger();
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const fetchCalls: string[] = [];
  const responses = [
    { path: '/rpc/control/api-keys', body: { openai: 'sk-test', anthropic: null, google: null } },
    { path: '/rpc/control/run-status', body: { status: 'running' } },
    { path: '/rpc/control/run-reset', body: {} },
  ];
  globalThis.fetch = ((input: unknown) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    fetchCalls.push(url);
    const expectedResponse = responses[callIndex];
    callIndex++;
    if (!expectedResponse) {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(expectedResponse.body), { status: expectedResponse.status ?? 200 }),
    );
  }) as typeof fetch;

  const executeRun = spy(async () => { throw new Error('Agent crash'); });
  try {
    const { executeRunInContainer } = await import('../run-executor.ts');
    await executeRunInContainer(
      {
        runId: 'r-1',
        workerId: 'w-1',
        controlRpcToken: 'tok',
        controlRpcBaseUrl: 'https://control.example.com',
      },
      {
        serviceName: 'test',
        logger: mockLogger,
        executeRun,
        runtimeConfig: {
          maxRunDurationMs: 60000,
        },
      },
    );

    // run-reset should have been called
    assertEquals(fetchCalls.some((u: string) => u.includes('/rpc/control/run-reset')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('executeRunInContainer - preserves terminal status when executeRun fails', async () => {
  const mockLogger = createMockLogger();
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const fetchCalls: string[] = [];
  const responses = [
    { path: '/rpc/control/api-keys', body: { openai: 'sk-test', anthropic: null, google: null } },
    { path: '/rpc/control/run-status', body: { status: 'completed' } },
  ];
  globalThis.fetch = ((input: unknown) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    fetchCalls.push(url);
    const expectedResponse = responses[callIndex];
    callIndex++;
    if (!expectedResponse) {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(expectedResponse.body), { status: expectedResponse.status ?? 200 }),
    );
  }) as typeof fetch;

  const executeRun = spy(async () => { throw new Error('Agent crash'); });
  try {
    const { executeRunInContainer } = await import('../run-executor.ts');
    await executeRunInContainer(
      {
        runId: 'r-1',
        workerId: 'w-1',
        controlRpcToken: 'tok',
        controlRpcBaseUrl: 'https://control.example.com',
      },
      {
        serviceName: 'test',
        logger: mockLogger,
        executeRun,
        runtimeConfig: {
          maxRunDurationMs: 60000,
        },
      },
    );

    // run-reset should NOT have been called
    assertEquals(fetchCalls.some((u: string) => u.includes('/rpc/control/run-reset')), false);
    // Check that logger.warn was called with the preserving message
    const warnCalls = mockLogger.warn.calls.map((c: { args: unknown[] }) => c.args[0] as string);
    assertEquals(warnCalls.some((msg: string) => msg.includes('Preserving run r-1 status completed')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('executeRunInContainer - resets run when fetchApiKeys fails', async () => {
  const mockLogger = createMockLogger();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    return Promise.reject(new Error('Network error'));
  }) as typeof fetch;
  try {
    const { executeRunInContainer } = await import('../run-executor.ts');
    await assertRejects(
      () =>
        executeRunInContainer(
          {
            runId: 'r-1',
            workerId: 'w-1',
            controlRpcToken: 'tok',
            controlRpcBaseUrl: 'https://control.example.com',
          },
          {
            serviceName: 'test',
            logger: mockLogger,
            executeRun: spy(),
          },
        ),
      Error,
      'Network error',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
