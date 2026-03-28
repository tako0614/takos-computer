/**
 * MCP Server for browser and display tools.
 *
 * Exposes:
 * - browser_*  — Playwright-based browser automation (Chrome only)
 * - display_*  — X11 display interaction via xdotool (any GUI app)
 * - app_*      — GUI application process management
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { BrowserManager } from './browser-manager.js';
import type { DisplayManager } from './display-manager.js';
import type { ProcessManager } from './process-manager.js';

export interface McpServerDeps {
  browser: BrowserManager;
  display?: DisplayManager;
  processes?: ProcessManager;
}

export function createBrowserMcpServer(deps: McpServerDeps): McpServer;
/** @deprecated Pass McpServerDeps object instead */
export function createBrowserMcpServer(browser: BrowserManager): McpServer;
export function createBrowserMcpServer(arg: BrowserManager | McpServerDeps): McpServer {
  const deps: McpServerDeps = 'bootstrap' in arg ? { browser: arg } : arg;
  const { browser, display, processes } = deps;

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

  // -------------------------------------------------------------------------
  // Display tools — X11 display-level interaction (works with any GUI app)
  // -------------------------------------------------------------------------

  if (display) {
    const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
    const json = (v: unknown) => text(JSON.stringify(v, null, 2));
    const mapBtn = (b?: string) => (b === 'right' ? 3 : b === 'middle' ? 2 : 1) as 1 | 2 | 3;

    server.tool('display_screenshot',
      'Capture the entire X11 display as an image. Use this to see what is on screen across all GUI apps.',
      { format: z.enum(['png', 'jpeg']).optional().describe('Image format (default: png)') },
      async ({ format }) => {
        const buf = await display.screenshot({ format: format ?? 'png' });
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        return { content: [{ type: 'image', data: Buffer.from(buf).toString('base64'), mimeType }] };
      },
    );

    server.tool('display_click',
      'Click at absolute screen coordinates. Use display_screenshot first to identify target positions.',
      {
        x: z.number().describe('X pixel coordinate (0 = left edge)'),
        y: z.number().describe('Y pixel coordinate (0 = top edge)'),
        button: z.enum(['left', 'middle', 'right']).optional().describe('Mouse button (default: left)'),
        clicks: z.number().optional().describe('Number of clicks (2 = double-click, 3 = triple-click, default: 1)'),
      },
      async ({ x, y, button, clicks }) => {
        await display.mouseClick(x, y, mapBtn(button), clicks ?? 1);
        return text(`Clicked at (${x}, ${y})`);
      },
    );

    server.tool('display_mouse_move',
      'Move the mouse cursor to absolute screen coordinates without clicking.',
      {
        x: z.number().describe('X pixel coordinate'),
        y: z.number().describe('Y pixel coordinate'),
      },
      async ({ x, y }) => {
        await display.mouseMove(x, y);
        return text(`Moved to (${x}, ${y})`);
      },
    );

    server.tool('display_drag',
      'Drag from one position to another (click-hold, move, release). Useful for sliders, drag-and-drop, and selections.',
      {
        from_x: z.number().describe('Start X coordinate'),
        from_y: z.number().describe('Start Y coordinate'),
        to_x: z.number().describe('End X coordinate'),
        to_y: z.number().describe('End Y coordinate'),
        button: z.enum(['left', 'middle', 'right']).optional().describe('Mouse button (default: left)'),
      },
      async ({ from_x, from_y, to_x, to_y, button }) => {
        await display.drag(from_x, from_y, to_x, to_y, mapBtn(button));
        return text(`Dragged (${from_x},${from_y}) -> (${to_x},${to_y})`);
      },
    );

    server.tool('display_scroll',
      'Scroll at the current mouse position or at specified coordinates.',
      {
        direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
        amount: z.number().optional().describe('Number of scroll steps (default: 3)'),
        x: z.number().optional().describe('X coordinate to scroll at (optional)'),
        y: z.number().optional().describe('Y coordinate to scroll at (optional)'),
      },
      async ({ direction, amount, x, y }) => {
        await display.scroll(direction, amount ?? 3, x, y);
        return text(`Scrolled ${direction} ${amount ?? 3} steps`);
      },
    );

    server.tool('display_type',
      'Type text into the currently focused window. Click a text field first, then use this to enter text.',
      { text: z.string().describe('Text to type') },
      async ({ text: t }) => {
        await display.keyType(t);
        return text(`Typed "${t}"`);
      },
    );

    server.tool('display_key',
      'Press a key or key combination. Examples: "Return", "Tab", "Escape", "BackSpace", "ctrl+a", "ctrl+c", "ctrl+v", "alt+F4", "shift+ctrl+s", "super"',
      { key: z.string().describe('Key name or combo in xdotool format') },
      async ({ key }) => {
        await display.keyPress(key);
        return text(`Pressed ${key}`);
      },
    );

    server.tool('display_clipboard_get',
      'Read the current clipboard contents. Useful after ctrl+c or to check what was copied.',
      {},
      async () => {
        const content = await display.getClipboard();
        return text(content || '(empty clipboard)');
      },
    );

    server.tool('display_clipboard_set',
      'Set the clipboard contents. Use display_key with "ctrl+v" afterwards to paste.',
      { text: z.string().describe('Text to put on the clipboard') },
      async ({ text: t }) => {
        await display.setClipboard(t);
        return text('Clipboard set');
      },
    );

    server.tool('display_screen_info',
      'Get display dimensions (width, height, color depth). Use this to know the coordinate bounds for clicking.',
      {},
      async () => json(await display.getScreenInfo()),
    );

    server.tool('display_cursor_position',
      'Get the current mouse cursor position.',
      {},
      async () => json(await display.getCursorPosition()),
    );

    server.tool('display_active_window',
      'Get the currently focused window: name, PID, position, and dimensions.',
      {},
      async () => json(await display.getActiveWindow()),
    );

    server.tool('display_windows',
      'List all visible windows with name, PID, position, and dimensions.',
      {},
      async () => json({ windows: await display.listWindows() }),
    );

    server.tool('display_find_window',
      'Find windows whose title contains a search string.',
      { name: z.string().describe('Substring to search for in window titles') },
      async ({ name }) => json({ windows: await display.findWindowByName(name) }),
    );

    server.tool('display_focus_window',
      'Bring a window to the front and give it keyboard focus.',
      { window_id: z.number().describe('X11 window ID (from display_windows or display_find_window)') },
      async ({ window_id }) => {
        await display.focusWindow(window_id);
        return text(`Focused window ${window_id}`);
      },
    );

    server.tool('display_wait_for_window',
      'Wait for a window with matching title to appear. Returns the window info when found or null on timeout.',
      {
        name: z.string().describe('Substring to search for in window titles'),
        timeout_ms: z.number().optional().describe('Max wait time in milliseconds (default: 10000)'),
      },
      async ({ name, timeout_ms }) => json(await display.waitForWindow(name, timeout_ms ?? 10000)),
    );

    server.tool('display_wait_for_screen_change',
      'Wait until the screen content visually changes (compares screenshots). Useful after triggering an action.',
      { timeout_ms: z.number().optional().describe('Max wait time in milliseconds (default: 10000)') },
      async ({ timeout_ms }) => {
        const changed = await display.waitForScreenChange(timeout_ms ?? 10000);
        return text(changed ? 'Screen changed' : 'Timed out — no change detected');
      },
    );
  }

  // -------------------------------------------------------------------------
  // App process tools — launch, list, kill GUI applications
  // -------------------------------------------------------------------------

  if (processes) {
    const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
    const json2 = (v: unknown) => text(JSON.stringify(v, null, 2));

    server.tool('app_launch',
      'Launch a GUI application on the X11 display. The app window will appear in VNC / display_screenshot.',
      {
        command: z.string().describe('Executable name or path (e.g. "xterm", "firefox", "python3")'),
        args: z.array(z.string()).optional().describe('Command-line arguments'),
      },
      async ({ command, args }) => json2(processes.launch({ command, args })),
    );

    server.tool('app_list',
      'List all managed GUI applications with PID, command, running status, and exit code.',
      {},
      async () => json2({ processes: processes.list() }),
    );

    server.tool('app_output',
      'Read captured stdout/stderr of a managed app. Useful for CLI tools and debugging.',
      {
        pid: z.number().describe('Process ID'),
        tail: z.number().optional().describe('Only return the last N lines (default: all)'),
      },
      async ({ pid, tail }) => {
        const out = processes.getOutput(pid, tail);
        if (!out) return text(`Process ${pid} not found`);
        return json2(out);
      },
    );

    server.tool('app_kill',
      'Stop a running application. Sends SIGTERM, then SIGKILL after 3 seconds if still alive.',
      { pid: z.number().describe('Process ID to kill') },
      async ({ pid }) => {
        const killed = processes.kill(pid);
        return text(killed ? `Killed ${pid}` : `Process ${pid} not found`);
      },
    );

    server.tool('app_wait',
      'Wait for an application to exit. Returns the exit code or null on timeout.',
      {
        pid: z.number().describe('Process ID'),
        timeout_ms: z.number().optional().describe('Max wait time in ms (default: 30000)'),
      },
      async ({ pid, timeout_ms }) => {
        const code = await processes.waitForExit(pid, timeout_ms ?? 30000);
        return json2({ pid, exitCode: code, timedOut: code === null });
      },
    );
  }

  return server;
}

/**
 * Create a request handler for the MCP server that works with Hono.
 * Handles POST /mcp for Streamable HTTP transport.
 *
 * @param authToken - If provided, validates Authorization: Bearer <token> header.
 */
export function createMcpRequestHandler(mcpServer: McpServer, authToken?: string) {
  return async (request: Request): Promise<Response> => {
    // Bearer token auth check
    if (authToken) {
      const header = request.headers.get('Authorization');
      const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token || token !== authToken) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await mcpServer.connect(transport);
    return transport.handleRequest(request);
  };
}
