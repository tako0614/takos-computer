import { describe, expect, it, vi } from 'vitest';

// Mock playwright-core and @takos-computer/common before importing app
vi.mock('playwright-core', () => ({
  chromium: {
    launchPersistentContext: vi.fn(),
  },
}));

vi.mock('@takos-computer/common/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('@takos-computer/common/validation', () => ({
  isPrivateIP: (ip: string) => ip.startsWith('10.') || ip.startsWith('192.168.'),
  isLocalhost: (hostname: string) => hostname === 'localhost' || hostname === '127.0.0.1',
}));

import { createBrowserServiceApp } from '../app.js';

describe('createBrowserServiceApp', () => {
  it('creates an app with browser, processes, and logger', () => {
    const { app, browser, processes, logger } = createBrowserServiceApp();
    expect(app).toBeDefined();
    expect(browser).toBeDefined();
    expect(processes).toBeDefined();
    expect(logger).toBeDefined();
  });
});

describe('health endpoint', () => {
  it('GET /healthz returns status ok', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/healthz');
    const res = await app.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('browserd');
    expect(body.browser_alive).toBe(false);
  });

  it('GET /healthz uses custom service name', async () => {
    const { app } = createBrowserServiceApp({ serviceName: 'my-browser' });
    const req = new Request('http://localhost/healthz');
    const res = await app.fetch(req);
    const body = await res.json();
    expect(body.service).toBe('my-browser');
  });
});

describe('MCP endpoint', () => {
  it('POST /mcp exists and accepts requests', async () => {
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
    expect(res.status).not.toBe(404);
  });
});

describe('removed REST routes return 404', () => {
  it('old /internal/* routes are gone', async () => {
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
      expect(res.status).toBe(404);
    }
  });
});
