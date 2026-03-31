import { Buffer } from 'node:buffer';
import { assertEquals, assert, assertRejects } from 'jsr:@std/assert';
import { spy, stub, assertSpyCalls } from 'jsr:@std/testing/mock';
import type { BrowserContext, Page, ElementHandle } from 'playwright-core';

// NOTE: This test file previously used vi.mock() for playwright-core and
// @takos-computer/common/logger. In Deno, module mocking is not directly
// supported. The tests that require mocked playwright contexts are adapted
// to use manual mock objects and stub the chromium launcher at the instance level.

import { BrowserManager, type BrowserAction } from '../browser-manager.ts';
import { chromium } from 'playwright-core';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

type MockPage = Partial<Page> & {
  goto: ReturnType<typeof spy>;
  url: ReturnType<typeof spy>;
  title: ReturnType<typeof spy>;
};

type MockContext = Partial<BrowserContext> & {
  pages: ReturnType<typeof spy>;
  newPage: ReturnType<typeof spy>;
  close: ReturnType<typeof spy>;
};

function createMockPage(overrides: Record<string, unknown> = {}): MockPage {
  return {
    goto: spy(() => undefined),
    url: spy(() => 'about:blank'),
    title: spy(async () => ''),
    ...overrides,
  } as MockPage;
}

function createMockContext(
  pages: MockPage[],
  overrides: Record<string, unknown> = {},
): MockContext {
  return {
    pages: spy(() => pages),
    newPage: spy(),
    close: spy(),
    ...overrides,
  } as MockContext;
}

function stubLaunch(ctx: MockContext): { restore: () => void } {
  const original = chromium.launchPersistentContext;
  (chromium as { launchPersistentContext: unknown }).launchPersistentContext = spy(
    async () => ctx as unknown as BrowserContext,
  );
  return {
    restore() {
      (chromium as { launchPersistentContext: unknown }).launchPersistentContext = original;
    },
  };
}

Deno.test('BrowserManager - isAlive returns false when context is not started', () => {
  const mgr = new BrowserManager();
  assertEquals(mgr.isAlive(), false);
});

Deno.test('BrowserManager - tabs returns empty array when context is not started', async () => {
  const mgr = new BrowserManager();
  const tabs = await mgr.tabs();
  assertEquals(tabs, []);
});

Deno.test('BrowserManager - action throws when no active page', async () => {
  const mgr = new BrowserManager();
  await assertRejects(
    () => mgr.action({ type: 'click', selector: '#btn' }),
    Error,
    'No active page',
  );
});

Deno.test('BrowserManager - goto throws when no active page', async () => {
  const mgr = new BrowserManager();
  await assertRejects(
    () => mgr.goto({ url: 'https://example.com' }),
    Error,
    'No active page',
  );
});

Deno.test('BrowserManager - html throws when no active page', async () => {
  const mgr = new BrowserManager();
  await assertRejects(() => mgr.html(), Error, 'No active page');
});

Deno.test('BrowserManager - screenshot throws when no active page', async () => {
  const mgr = new BrowserManager();
  await assertRejects(() => mgr.screenshot(), Error, 'No active page');
});

Deno.test('BrowserManager - pdf throws when no active page', async () => {
  const mgr = new BrowserManager();
  await assertRejects(() => mgr.pdf(), Error, 'No active page');
});

Deno.test('BrowserManager - extract throws when no active page', async () => {
  const mgr = new BrowserManager();
  await assertRejects(
    () => mgr.extract({ selector: 'div' }),
    Error,
    'No active page',
  );
});

Deno.test('BrowserManager - newTab throws when context is not started', async () => {
  const mgr = new BrowserManager();
  await assertRejects(() => mgr.newTab(), Error, 'Browser not started');
});

Deno.test('BrowserManager - closeTab throws when context is not started', async () => {
  const mgr = new BrowserManager();
  await assertRejects(() => mgr.closeTab(0), Error, 'Browser not started');
});

Deno.test('BrowserManager - switchTab throws when context is not started', async () => {
  const mgr = new BrowserManager();
  await assertRejects(() => mgr.switchTab(0), Error, 'Browser not started');
});

Deno.test('BrowserManager - close does nothing when context is null', async () => {
  const mgr = new BrowserManager();
  // Should not throw
  await mgr.close();
  assertEquals(mgr.isAlive(), false);
});

Deno.test('BrowserManager - bootstrap launches persistent context and returns page info', async () => {
  const mockPage = createMockPage({
    title: spy(async () => 'New Tab'),
  });
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    const result = await mgr.bootstrap({});

    assertEquals(result.ok, true);
    assertEquals(result.url, 'about:blank');
    assertEquals(result.title, 'New Tab');
    assertEquals(mgr.isAlive(), true);
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - bootstrap navigates to URL when provided', async () => {
  const mockPage = createMockPage({
    goto: spy(async () => undefined),
    url: spy(() => 'https://example.com'),
    title: spy(async () => 'Example'),
  });
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    const result = await mgr.bootstrap({ url: 'https://example.com' });

    assertSpyCalls(mockPage.goto, 1);
    assertEquals(result.url, 'https://example.com');
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - bootstrap creates new page when no default pages exist', async () => {
  const mockPage = createMockPage();
  const mockContext = createMockContext([], {
    newPage: spy(async () => mockPage),
  });
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    const result = await mgr.bootstrap({});

    assertSpyCalls(mockContext.newPage, 1);
    assertEquals(result.ok, true);
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - goto with mocked context returns url, title and status', async () => {
  const mockResponse = { status: spy(() => 200) };
  const mockPage = createMockPage({
    goto: spy(async () => mockResponse),
    url: spy(() => 'https://example.com/page'),
    title: spy(async () => 'Page Title'),
  });
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});

    const result = await mgr.goto({ url: 'https://example.com/page' });
    assertEquals(result.url, 'https://example.com/page');
    assertEquals(result.title, 'Page Title');
    assertEquals(result.status, 200);
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - goto returns null status when response is null', async () => {
  const mockPage = createMockPage({
    goto: spy(async () => null),
  });
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});

    const result = await mgr.goto({ url: 'https://example.com' });
    assertEquals(result.status, null);
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - action handles click action', async () => {
  const mockPage = createMockPage({
    click: spy(async () => undefined),
    fill: spy(),
    selectOption: spy(),
    hover: spy(),
    check: spy(),
    uncheck: spy(),
    focus: spy(),
    $: spy(),
    keyboard: { press: spy() },
    mouse: { wheel: spy() },
  });
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});

    const result = await mgr.action({ type: 'click', selector: '#btn' });
    assertEquals(result.ok, true);
    assert(result.message.includes('Clicked #btn'));
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - action throws for unknown action type', async () => {
  const mockPage = createMockPage({
    click: spy(),
    fill: spy(),
    selectOption: spy(),
    hover: spy(),
    check: spy(),
    uncheck: spy(),
    focus: spy(),
    $: spy(),
    keyboard: { press: spy() },
    mouse: { wheel: spy() },
  });
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});

    await assertRejects(
      () => mgr.action({ type: 'unknown-action' } as unknown as BrowserAction),
      Error,
      'Unknown action type: unknown-action',
    );
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - html with mocked context returns page content and url', async () => {
  const mockPage = createMockPage({
    url: spy(() => 'https://example.com'),
    title: spy(async () => 'Example'),
    content: spy(async () => '<html><body><h1>Hello</h1></body></html>'),
  });
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});

    const result = await mgr.html();
    assertEquals(result.html, '<html><body><h1>Hello</h1></body></html>');
    assertEquals(result.url, 'https://example.com');
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - screenshot calls page.screenshot and returns buffer', async () => {
  const screenshotBuffer = Buffer.from('fake-png-data');
  const mockPage = createMockPage({
    screenshot: spy(async () => screenshotBuffer),
  });
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});

    const result = await mgr.screenshot();
    assertEquals(result, screenshotBuffer);
    assertEquals(Buffer.isBuffer(result), true);
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - pdf calls page.pdf and returns buffer', async () => {
  const pdfBuffer = Buffer.from('fake-pdf-data');
  const mockPage = createMockPage({
    pdf: spy(async () => pdfBuffer),
  });
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});

    const result = await mgr.pdf();
    assertEquals(result, pdfBuffer);
    assertEquals(Buffer.isBuffer(result), true);
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - close closes the context and resets state', async () => {
  const mockPage = createMockPage();
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});
    assertEquals(mgr.isAlive(), true);

    await mgr.close();

    assertSpyCalls(mockContext.close, 1);
    assertEquals(mgr.isAlive(), false);
    await assertRejects(() => mgr.html(), Error, 'No active page');
    await assertRejects(() => mgr.screenshot(), Error, 'No active page');
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - close handles error during context.close gracefully', async () => {
  const mockPage = createMockPage();
  const mockContext = createMockContext([mockPage], {
    close: spy(async () => { throw new Error('Browser crashed'); }),
  });
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});

    // Should not throw even when context.close fails
    await mgr.close();
    assertEquals(mgr.isAlive(), false);
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - closeTab throws for out-of-range index', async () => {
  const mockPage = createMockPage();
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});

    await assertRejects(() => mgr.closeTab(5), Error, 'Tab index 5 out of range');
    await assertRejects(() => mgr.closeTab(-1), Error, 'Tab index -1 out of range');
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - switchTab throws for out-of-range index', async () => {
  const mockPage = createMockPage();
  const mockContext = createMockContext([mockPage]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});

    await assertRejects(() => mgr.switchTab(3), Error, 'Tab index 3 out of range');
  } finally {
    launchStub.restore();
  }
});

Deno.test('BrowserManager - tabs returns info for each page', async () => {
  const page1 = createMockPage({
    url: spy(() => 'https://a.com'),
    title: spy(async () => 'Page A'),
  });
  const page2 = createMockPage({
    url: spy(() => 'https://b.com'),
    title: spy(async () => 'Page B'),
  });
  const mockContext = createMockContext([page1, page2]);
  const launchStub = stubLaunch(mockContext);

  try {
    const mgr = new BrowserManager();
    await mgr.bootstrap({});

    const tabs = await mgr.tabs();
    assertEquals(tabs.length, 2);
    assertEquals(tabs[0].url, 'https://a.com');
    assertEquals(tabs[0].active, true);
    assertEquals(tabs[1].url, 'https://b.com');
    assertEquals(tabs[1].active, false);
  } finally {
    launchStub.restore();
  }
});
