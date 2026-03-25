/**
 * MCP Server for browser tools.
 *
 * Exposes browser_open, browser_goto, browser_action, browser_screenshot,
 * browser_extract, browser_html, browser_close as MCP tools over
 * Streamable HTTP transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { BrowserManager } from './browser-manager.js';

export function createBrowserMcpServer(browser: BrowserManager): McpServer {
  const server = new McpServer({
    name: 'takos-computer-browser',
    version: '1.0.0',
  });

  server.tool(
    'browser_open',
    'Open a browser session and optionally navigate to a URL',
    {
      url: z.string().optional().describe('Initial URL to navigate to'),
      viewport_width: z.number().optional().describe('Viewport width in pixels (default: 1280)'),
      viewport_height: z.number().optional().describe('Viewport height in pixels (default: 720)'),
    },
    async ({ url, viewport_width, viewport_height }) => {
      const result = await browser.bootstrap({
        url,
        viewport: {
          width: viewport_width ?? 1280,
          height: viewport_height ?? 720,
        },
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'browser_goto',
    'Navigate the browser to a URL',
    {
      url: z.string().describe('URL to navigate to'),
      wait_until: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional(),
    },
    async ({ url, wait_until }) => {
      const result = await browser.goto({ url, waitUntil: wait_until });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'browser_action',
    'Perform an action on the page (click, type, scroll, etc.)',
    {
      action: z.enum(['click', 'type', 'scroll', 'select', 'hover', 'press', 'check', 'uncheck', 'focus', 'clear']),
      selector: z.string().optional().describe('CSS selector for target element'),
      text: z.string().optional().describe('Text to type'),
      key: z.string().optional().describe('Key to press (e.g. Enter, Tab)'),
      value: z.string().optional().describe('Value to select'),
      direction: z.enum(['up', 'down', 'left', 'right']).optional(),
      amount: z.number().optional().describe('Scroll amount in pixels'),
    },
    async (args) => {
      const result = await browser.action({
        type: args.action,
        selector: args.selector,
        text: args.text,
        key: args.key,
        value: args.value,
        direction: args.direction,
        amount: args.amount,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'browser_screenshot',
    'Take a screenshot of the current page',
    {},
    async () => {
      const png = await browser.screenshot();
      const base64 = Buffer.from(png).toString('base64');
      return { content: [{ type: 'image', data: base64, mimeType: 'image/png' }] };
    },
  );

  server.tool(
    'browser_extract',
    'Extract data from the page using CSS selector or JavaScript',
    {
      selector: z.string().optional().describe('CSS selector'),
      evaluate: z.string().optional().describe('JavaScript expression to evaluate'),
    },
    async ({ selector, evaluate }) => {
      const result = await browser.extract({ selector, evaluate });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'browser_html',
    'Get the HTML content of the current page',
    {},
    async () => {
      const result = await browser.html();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'browser_close',
    'Close the browser session',
    {},
    async () => {
      await browser.close();
      return { content: [{ type: 'text', text: '{"status": "closed"}' }] };
    },
  );

  return server;
}

/**
 * Create a request handler for the MCP server that works with Hono.
 * Handles POST /mcp for Streamable HTTP transport.
 */
export function createMcpRequestHandler(mcpServer: McpServer) {
  return async (request: Request): Promise<Response> => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await mcpServer.connect(transport);
    return transport.handleRequest(request);
  };
}
