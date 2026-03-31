/**
 * X11 display-level interaction manager.
 *
 * Uses xdotool for mouse/keyboard, scrot for screenshots, and xclip for
 * clipboard. Unlike BrowserManager (Playwright, browser-only), this controls
 * the entire X11 display — any GUI app visible on the screen.
 */

import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DisplayScreenshotOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
}

export interface ScreenInfo {
  width: number;
  height: number;
  depth: number;
  display: string;
}

export interface CursorPosition {
  x: number;
  y: number;
  screen: number;
  window: number;
}

export interface WindowInfo {
  id: number;
  name: string;
  pid: number | null;
  geometry: { x: number; y: number; width: number; height: number } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DISPLAY = () => Deno.env.get('DISPLAY') ?? ':99';

function xdotool(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execAsync('xdotool', args, {
    env: { ...Deno.env.toObject(), DISPLAY: DISPLAY() },
    timeout: 10000,
  });
}

function xEnv(): Record<string, string> {
  return { ...Deno.env.toObject(), DISPLAY: DISPLAY() };
}

function randomId(): string {
  return randomBytes(6).toString('hex');
}

function parseWindowGeometry(shellOutput: string): WindowInfo['geometry'] {
  const vals: Record<string, number> = {};
  for (const line of shellOutput.trim().split('\n')) {
    const [k, v] = line.split('=');
    if (k && v) vals[k.trim()] = parseInt(v.trim(), 10);
  }
  if ('X' in vals && 'Y' in vals && 'WIDTH' in vals && 'HEIGHT' in vals) {
    return { x: vals.X, y: vals.Y, width: vals.WIDTH, height: vals.HEIGHT };
  }
  return null;
}

async function getWindowDetails(winId: number): Promise<WindowInfo> {
  const [nameResult, pidResult, geoResult] = await Promise.allSettled([
    xdotool('getwindowname', String(winId)),
    xdotool('getwindowpid', String(winId)),
    xdotool('getwindowgeometry', '--shell', String(winId)),
  ]);

  const name = nameResult.status === 'fulfilled' ? nameResult.value.stdout.trim() : '';
  const rawPid = pidResult.status === 'fulfilled' ? parseInt(pidResult.value.stdout.trim(), 10) : NaN;
  const geometry = geoResult.status === 'fulfilled'
    ? parseWindowGeometry(geoResult.value.stdout)
    : null;

  return { id: winId, name, pid: isNaN(rawPid) ? null : rawPid, geometry };
}

// ---------------------------------------------------------------------------
// DisplayManager
// ---------------------------------------------------------------------------

export class DisplayManager {

  // -----------------------------------------------------------------------
  // Screen info
  // -----------------------------------------------------------------------

  /** Get display dimensions and metadata. */
  async getScreenInfo(): Promise<ScreenInfo> {
    const { stdout } = await execAsync('xdpyinfo', [], { env: xEnv(), timeout: 5000 });
    let width = 1280, height = 720, depth = 24;
    const dimMatch = stdout.match(/dimensions:\s+(\d+)x(\d+)/);
    if (dimMatch) { width = parseInt(dimMatch[1], 10); height = parseInt(dimMatch[2], 10); }
    const depthMatch = stdout.match(/depth of root window:\s+(\d+)/);
    if (depthMatch) { depth = parseInt(depthMatch[1], 10); }
    return { width, height, depth, display: DISPLAY() };
  }

  /** Get current cursor position. */
  async getCursorPosition(): Promise<CursorPosition> {
    const { stdout } = await xdotool('getmouselocation', '--shell');
    const vals: Record<string, number> = {};
    for (const line of stdout.trim().split('\n')) {
      const [k, v] = line.split('=');
      if (k && v) vals[k.trim()] = parseInt(v.trim(), 10);
    }
    return {
      x: vals.X ?? 0,
      y: vals.Y ?? 0,
      screen: vals.SCREEN ?? 0,
      window: vals.WINDOW ?? 0,
    };
  }

  // -----------------------------------------------------------------------
  // Screenshots
  // -----------------------------------------------------------------------

  /** Capture the entire X11 display. */
  async screenshot(options: DisplayScreenshotOptions = {}): Promise<Buffer> {
    const format = options.format ?? 'png';
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const tmpPath = join(tmpdir(), `display-${randomId()}.${ext}`);

    try {
      const scrotArgs = ['--overwrite', tmpPath];
      if (format === 'jpeg' && options.quality != null) {
        scrotArgs.unshift('--quality', String(options.quality));
      }
      await execAsync('scrot', scrotArgs, { env: xEnv(), timeout: 10000 });
      return await readFile(tmpPath);
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  // -----------------------------------------------------------------------
  // Mouse
  // -----------------------------------------------------------------------

  /** Click at absolute screen coordinates. */
  async mouseClick(x: number, y: number, button: 1 | 2 | 3 = 1, clicks = 1): Promise<void> {
    await xdotool('mousemove', '--sync', String(x), String(y));
    if (clicks === 2) {
      await xdotool('click', '--repeat', '2', '--delay', '50', String(button));
    } else {
      for (let i = 0; i < clicks; i++) {
        await xdotool('click', String(button));
      }
    }
  }

  /** Move mouse to absolute screen coordinates. */
  async mouseMove(x: number, y: number): Promise<void> {
    await xdotool('mousemove', '--sync', String(x), String(y));
  }

  /** Press a mouse button down at (x, y). Use with mouseUp for drag. */
  async mouseDown(x: number, y: number, button: 1 | 2 | 3 = 1): Promise<void> {
    await xdotool('mousemove', '--sync', String(x), String(y));
    await xdotool('mousedown', String(button));
  }

  /** Release a mouse button at (x, y). Use with mouseDown for drag. */
  async mouseUp(x: number, y: number, button: 1 | 2 | 3 = 1): Promise<void> {
    await xdotool('mousemove', '--sync', String(x), String(y));
    await xdotool('mouseup', String(button));
  }

  /** Drag from (x1,y1) to (x2,y2). */
  async drag(x1: number, y1: number, x2: number, y2: number, button: 1 | 2 | 3 = 1): Promise<void> {
    await this.mouseDown(x1, y1, button);
    // Small delay for the source app to register the drag start
    await new Promise(r => setTimeout(r, 50));
    await xdotool('mousemove', '--sync', String(x2), String(y2));
    await new Promise(r => setTimeout(r, 50));
    await xdotool('mouseup', String(button));
  }

  /** Scroll at current (or specified) position. */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount = 3, x?: number, y?: number): Promise<void> {
    if (x != null && y != null) {
      await xdotool('mousemove', '--sync', String(x), String(y));
    }
    // xdotool click: button 4=up, 5=down, 6=left, 7=right
    const btn = direction === 'up' ? '4' : direction === 'down' ? '5' : direction === 'left' ? '6' : '7';
    await xdotool('click', '--repeat', String(amount), '--delay', '20', btn);
  }

  // -----------------------------------------------------------------------
  // Keyboard
  // -----------------------------------------------------------------------

  /** Type text into the currently focused window. */
  async keyType(text: string): Promise<void> {
    await xdotool('type', '--clearmodifiers', '--delay', '12', text);
  }

  /**
   * Press a key combination.
   * xdotool format: "Return", "ctrl+a", "alt+F4", "super", "shift+ctrl+s"
   */
  async keyPress(key: string): Promise<void> {
    await xdotool('key', '--clearmodifiers', key);
  }

  // -----------------------------------------------------------------------
  // Clipboard
  // -----------------------------------------------------------------------

  /** Get clipboard contents. */
  async getClipboard(): Promise<string> {
    try {
      const { stdout } = await execAsync('xclip', ['-selection', 'clipboard', '-o'], {
        env: xEnv(), timeout: 5000,
      });
      return stdout;
    } catch {
      return '';
    }
  }

  /** Set clipboard contents. */
  async setClipboard(text: string): Promise<void> {
    const child = require('node:child_process').spawn(
      'xclip', ['-selection', 'clipboard', '-i'],
      { env: xEnv(), stdio: ['pipe', 'ignore', 'ignore'] },
    );
    child.stdin.write(text);
    child.stdin.end();
    await new Promise<void>((resolve, reject) => {
      child.on('close', (code: number) => code === 0 ? resolve() : reject(new Error(`xclip exit ${code}`)));
      child.on('error', reject);
    });
  }

  // -----------------------------------------------------------------------
  // Window management
  // -----------------------------------------------------------------------

  /** Get info about the currently active/focused window. */
  async getActiveWindow(): Promise<WindowInfo | null> {
    try {
      const { stdout: idStr } = await xdotool('getactivewindow');
      const winId = parseInt(idStr.trim(), 10);
      if (isNaN(winId)) return null;
      return getWindowDetails(winId);
    } catch {
      return null;
    }
  }

  /** List all visible windows with full details. */
  async listWindows(): Promise<WindowInfo[]> {
    try {
      const { stdout } = await xdotool('search', '--onlyvisible', '--name', '');
      const ids = stdout.trim().split('\n').filter(Boolean).map(s => parseInt(s.trim(), 10));
      const windows: WindowInfo[] = [];

      for (const winId of ids.slice(0, 100)) {
        if (isNaN(winId)) continue;
        try {
          const info = await getWindowDetails(winId);
          if (info.name) windows.push(info);
        } catch { /* skip inaccessible windows */ }
      }
      return windows;
    } catch {
      return [];
    }
  }

  /** Find windows by title (substring match). */
  async findWindowByName(name: string): Promise<WindowInfo[]> {
    try {
      const { stdout } = await xdotool('search', '--onlyvisible', '--name', name);
      const ids = stdout.trim().split('\n').filter(Boolean).map(s => parseInt(s.trim(), 10));
      const windows: WindowInfo[] = [];
      for (const winId of ids.slice(0, 50)) {
        if (isNaN(winId)) continue;
        try { windows.push(await getWindowDetails(winId)); } catch {}
      }
      return windows;
    } catch {
      return [];
    }
  }

  /** Focus (activate) a window by ID. */
  async focusWindow(windowId: number): Promise<void> {
    await xdotool('windowactivate', '--sync', String(windowId));
  }

  /** Minimize a window. */
  async minimizeWindow(windowId: number): Promise<void> {
    await xdotool('windowminimize', String(windowId));
  }

  /** Move and/or resize a window. Pass -1 to keep current value. */
  async moveResizeWindow(windowId: number, x: number, y: number, width: number, height: number): Promise<void> {
    if (x >= 0 && y >= 0) {
      await xdotool('windowmove', String(windowId), String(x), String(y));
    }
    if (width > 0 && height > 0) {
      await xdotool('windowsize', String(windowId), String(width), String(height));
    }
  }

  // -----------------------------------------------------------------------
  // Wait utilities
  // -----------------------------------------------------------------------

  /** Wait for a window with matching name to appear. */
  async waitForWindow(name: string, timeoutMs = 10000): Promise<WindowInfo | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const wins = await this.findWindowByName(name);
      if (wins.length > 0) return wins[0];
      await new Promise(r => setTimeout(r, 300));
    }
    return null;
  }

  /** Wait for screen content to change (compares screenshot hashes). */
  async waitForScreenChange(timeoutMs = 10000, regionNotUsed?: undefined): Promise<boolean> {
    const initial = await this.screenshot({ format: 'jpeg', quality: 30 });
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 200));
      const current = await this.screenshot({ format: 'jpeg', quality: 30 });
      if (!initial.equals(current)) return true;
    }
    return false;
  }
}
