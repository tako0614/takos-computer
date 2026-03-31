import { assertEquals, assert, assertNotEquals } from 'jsr:@std/assert';

// NOTE: This test file previously used vi.mock() for playwright-core and
// @takos-computer/common modules. In Deno, module mocking is not directly
// supported. These tests exercise createBrowserServiceApp which may need
// the actual modules or a test-specific setup. The tests below cover the
// HTTP routing behavior that does not require a real browser.

import { createBrowserServiceApp } from '../app.ts';

Deno.test('createBrowserServiceApp - creates an app with browser, processes, and logger', () => {
  const { app, browser, processes, logger } = createBrowserServiceApp();
  assert(app !== undefined);
  assert(browser !== undefined);
  assert(processes !== undefined);
  assert(logger !== undefined);
});

Deno.test('health endpoint - GET /healthz returns status ok', async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request('http://localhost/healthz');
  const res = await app.fetch(req);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, 'ok');
  assertEquals(body.service, 'browserd');
  assertEquals(body.browser_alive, false);
});

Deno.test('health endpoint - GET /healthz uses custom service name', async () => {
  const { app } = createBrowserServiceApp({ serviceName: 'my-browser' });
  const req = new Request('http://localhost/healthz');
  const res = await app.fetch(req);
  const body = await res.json();
  assertEquals(body.service, 'my-browser');
});

Deno.test('MCP endpoint - POST /mcp exists and accepts requests', async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
      id: 1,
    }),
  });
  const res = await app.fetch(req);
  // MCP should respond (not 404)
  assertNotEquals(res.status, 404);
});

Deno.test('removed REST routes return 404 - old /internal/* routes are gone', async () => {
  const { app } = createBrowserServiceApp();
  for (const path of [
    '/internal/healthz',
    '/internal/bootstrap',
    '/internal/goto',
    '/internal/action',
    '/internal/screenshot',
    '/internal/tabs',
  ]) {
    const res = await app.fetch(new Request(`http://localhost${path}`));
    assertEquals(res.status, 404);
  }
});
