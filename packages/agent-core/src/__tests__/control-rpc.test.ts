import { assertEquals, assertRejects, assertObjectMatch, assertStringIncludes } from 'jsr:@std/assert';
import { spy, assertSpyCalls } from 'jsr:@std/testing/mock';
import {
  ControlRpcClient,
  createStaticControlRpcTokenSource,
  isControlRpcPath,
  getRequiredControlRpcCapability,
} from '../control-rpc.ts';

// ---------------------------------------------------------------------------
// createStaticControlRpcTokenSource
// ---------------------------------------------------------------------------

Deno.test('createStaticControlRpcTokenSource - returns the same token for any path', () => {
  const source = createStaticControlRpcTokenSource('my-token');
  assertEquals(source.tokenForPath('/rpc/control/heartbeat'), 'my-token');
  assertEquals(source.tokenForPath('/rpc/control/run-status'), 'my-token');
  assertEquals(source.tokenForPath('/anything'), 'my-token');
});

// ---------------------------------------------------------------------------
// isControlRpcPath
// ---------------------------------------------------------------------------

const validPaths = [
  '/rpc/control/heartbeat',
  '/rpc/control/run-status',
  '/rpc/control/run-record',
  '/rpc/control/run-bootstrap',
  '/rpc/control/run-fail',
  '/rpc/control/run-reset',
  '/rpc/control/api-keys',
  '/rpc/control/billing-run-usage',
  '/rpc/control/run-context',
  '/rpc/control/no-llm-complete',
  '/rpc/control/conversation-history',
  '/rpc/control/skill-plan',
  '/rpc/control/memory-activation',
  '/rpc/control/memory-finalize',
  '/rpc/control/add-message',
  '/rpc/control/update-run-status',
  '/rpc/control/current-session',
  '/rpc/control/is-cancelled',
  '/rpc/control/tool-catalog',
  '/rpc/control/tool-execute',
  '/rpc/control/tool-cleanup',
  '/rpc/control/run-event',
];

for (const path of validPaths) {
  Deno.test(`isControlRpcPath - recognizes ${path}`, () => {
    assertEquals(isControlRpcPath(path), true);
  });
}

Deno.test('isControlRpcPath - rejects unknown paths', () => {
  assertEquals(isControlRpcPath('/rpc/control/unknown'), false);
  assertEquals(isControlRpcPath('/health'), false);
  assertEquals(isControlRpcPath(''), false);
  assertEquals(isControlRpcPath('/rpc/control/'), false);
});

// ---------------------------------------------------------------------------
// getRequiredControlRpcCapability
// ---------------------------------------------------------------------------

Deno.test('getRequiredControlRpcCapability - returns "control" for valid RPC paths', () => {
  assertEquals(getRequiredControlRpcCapability('/rpc/control/heartbeat'), 'control');
  assertEquals(getRequiredControlRpcCapability('/rpc/control/run-event'), 'control');
});

Deno.test('getRequiredControlRpcCapability - returns null for non-RPC paths', () => {
  assertEquals(getRequiredControlRpcCapability('/health'), null);
  assertEquals(getRequiredControlRpcCapability('/unknown'), null);
});

// ---------------------------------------------------------------------------
// ControlRpcClient
// ---------------------------------------------------------------------------

function createFetchSpy() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let responseQueue: Array<Response> = [];

  const fetchFn = ((input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push({ url, init: init ?? {} });
    const response = responseQueue.shift();
    if (response) return Promise.resolve(response);
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  }) as typeof fetch;

  return {
    fn: fetchFn,
    calls,
    mockResponse(body: unknown, status = 200) {
      responseQueue.push(new Response(JSON.stringify(body), { status }));
    },
    mockReject(error: Error) {
      responseQueue.push(undefined as unknown as Response);
      // Override for next call
      const origFn = fetchFn;
      // We'll use a different approach for reject
    },
  };
}

function withMockedFetch(fn: (mock: ReturnType<typeof createFetchSpy>) => Promise<void>) {
  return async () => {
    const originalFetch = globalThis.fetch;
    const mock = createFetchSpy();
    globalThis.fetch = mock.fn;
    try {
      await fn(mock);
    } finally {
      globalThis.fetch = originalFetch;
    }
  };
}

function createClient(baseUrl = 'https://control.example.com', runId = 'run-1') {
  return new ControlRpcClient(
    baseUrl,
    runId,
    createStaticControlRpcTokenSource('test-token'),
  );
}

Deno.test('ControlRpcClient - strips trailing slash from baseUrl', withMockedFetch(async (mock) => {
  const client = createClient('https://control.example.com/');
  mock.mockResponse({ status: 'running' });

  await client.getRunStatus('run-1');

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.calls[0].url, 'https://control.example.com/rpc/control/run-status');
}));

Deno.test('ControlRpcClient - sends correct authorization headers', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({ status: 'running' });

  await client.getRunStatus('run-1');

  const init = mock.calls[0].init;
  assertObjectMatch(init.headers as Record<string, string>, {
    Authorization: 'Bearer test-token',
    'X-Takos-Run-Id': 'run-1',
    'Content-Type': 'application/json',
  });
}));

Deno.test('ControlRpcClient - sends POST with JSON body', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({ status: 'running' });

  await client.getRunStatus('run-42');

  const init = mock.calls[0].init;
  assertEquals(init.method, 'POST');
  const body = JSON.parse(init.body as string);
  assertEquals(body, { runId: 'run-42' });
}));

Deno.test('ControlRpcClient - getRunStatus returns the status from the response', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({ status: 'running' });

  const status = await client.getRunStatus('run-1');
  assertEquals(status, 'running');
}));

Deno.test('ControlRpcClient - getRunStatus returns null when status is not present', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({});

  const status = await client.getRunStatus('run-1');
  assertEquals(status, null);
}));

Deno.test('ControlRpcClient - heartbeat posts heartbeat payload', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({});

  await client.heartbeat({ runId: 'run-1', workerId: 'w-1', leaseVersion: 2 });

  const body = JSON.parse(mock.calls[0].init.body as string);
  assertEquals(body, { runId: 'run-1', serviceId: 'w-1', workerId: 'w-1', leaseVersion: 2 });
}));

Deno.test('ControlRpcClient - failRun posts fail payload', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({});

  await client.failRun({ runId: 'run-1', workerId: 'w-1', error: 'oops' });

  assertStringIncludes(mock.calls[0].url, '/rpc/control/run-fail');
}));

Deno.test('ControlRpcClient - resetRun posts reset payload', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({});

  await client.resetRun({ runId: 'run-1', workerId: 'w-1' });

  assertStringIncludes(mock.calls[0].url, '/rpc/control/run-reset');
}));

Deno.test('ControlRpcClient - fetchApiKeys returns available keys', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({ openai: 'sk-abc', anthropic: null, google: 'gcp-123' });

  const keys = await client.fetchApiKeys();
  assertEquals(keys.openai, 'sk-abc');
  assertEquals(keys.anthropic, undefined);
  assertEquals(keys.google, 'gcp-123');
}));

Deno.test('ControlRpcClient - fetchApiKeys returns undefined for null keys', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({ openai: null, anthropic: null, google: null });

  const keys = await client.fetchApiKeys();
  assertEquals(keys.openai, undefined);
  assertEquals(keys.anthropic, undefined);
  assertEquals(keys.google, undefined);
}));

Deno.test('ControlRpcClient - getConversationHistory returns history array', withMockedFetch(async (mock) => {
  const client = createClient();
  const messages = [{ role: 'user', content: 'Hello' }];
  mock.mockResponse({ history: messages });

  const result = await client.getConversationHistory({
    runId: 'r', threadId: 't', spaceId: 's', aiModel: 'gpt-4',
  });
  assertEquals(result, messages);
}));

Deno.test('ControlRpcClient - getConversationHistory returns empty array when history is not an array', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({ history: 'not-an-array' });

  const result = await client.getConversationHistory({
    runId: 'r', threadId: 't', spaceId: 's', aiModel: 'gpt-4',
  });
  assertEquals(result, []);
}));

Deno.test('ControlRpcClient - isCancelled returns true when cancelled', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({ cancelled: true });

  assertEquals(await client.isCancelled('run-1'), true);
}));

Deno.test('ControlRpcClient - isCancelled returns false when not cancelled', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({ cancelled: false });

  assertEquals(await client.isCancelled('run-1'), false);
}));

Deno.test('ControlRpcClient - isCancelled returns false for non-boolean values', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({ cancelled: 'yes' });

  assertEquals(await client.isCancelled('run-1'), false);
}));

Deno.test('ControlRpcClient - getCurrentSessionId returns sessionId when present', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({ sessionId: 'sess-1' });

  assertEquals(await client.getCurrentSessionId({ runId: 'r', spaceId: 's' }), 'sess-1');
}));

Deno.test('ControlRpcClient - getCurrentSessionId returns null when sessionId is absent', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({});

  assertEquals(await client.getCurrentSessionId({ runId: 'r', spaceId: 's' }), null);
}));

Deno.test('ControlRpcClient - throws on non-ok response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    return Promise.resolve(new Response('Server Error', { status: 500 }));
  }) as typeof fetch;
  try {
    const client = createClient();
    await assertRejects(
      () => client.getRunStatus('run-1'),
      Error,
      'Control RPC /rpc/control/run-status failed with 500',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('ControlRpcClient - throws on malformed JSON response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    return Promise.resolve(new Response('not-json', { status: 200 }));
  }) as typeof fetch;
  try {
    const client = createClient();
    await assertRejects(
      () => client.getRunStatus('run-1'),
      Error,
      'malformed JSON',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('ControlRpcClient - executeTool sends tool execution request', withMockedFetch(async (mock) => {
  const client = createClient();
  const toolResult = { tool_call_id: 'tc-1', output: 'result' };
  mock.mockResponse(toolResult);

  const result = await client.executeTool({
    runId: 'run-1',
    toolCall: { id: 'tc-1', name: 'read_file', arguments: { path: '/foo' } },
  });

  assertEquals(result, toolResult);
  assertStringIncludes(mock.calls[0].url, '/rpc/control/tool-execute');
}));

Deno.test('ControlRpcClient - emitRunEvent sends run event', withMockedFetch(async (mock) => {
  const client = createClient();
  mock.mockResponse({});

  await client.emitRunEvent({
    runId: 'run-1',
    type: 'started',
    data: { model: 'gpt-4' },
    sequence: 1,
  });

  assertStringIncludes(mock.calls[0].url, '/rpc/control/run-event');
}));
