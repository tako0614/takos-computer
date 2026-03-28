/**
 * GUI process manager.
 *
 * Spawns, tracks, and kills X11 applications on the shared DISPLAY.
 * Captures stdout/stderr so AI agents can read application output.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createLogger } from '@takos-computer/common/logger';

const logger = createLogger({ service: 'browserd' });

const MAX_OUTPUT_BYTES = 256 * 1024; // 256 KB per stream

export interface ProcessInfo {
  pid: number;
  command: string;
  args: string[];
  startedAt: string;
  running: boolean;
  exitCode: number | null;
}

export interface ProcessOutput {
  pid: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface LaunchOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface ProcessEntry {
  child: ChildProcess;
  command: string;
  args: string[];
  startedAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export class ProcessManager {
  private processes = new Map<number, ProcessEntry>();

  launch(options: LaunchOptions): ProcessInfo {
    const { command, args = [], env: extraEnv, cwd } = options;

    const child = spawn(command, args, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: cwd ?? '/tmp',
      env: {
        ...process.env,
        ...extraEnv,
        DISPLAY: process.env.DISPLAY ?? ':99',
      },
    });

    const pid = child.pid;
    if (pid == null) {
      throw new Error(`Failed to spawn: ${command}`);
    }

    const entry: ProcessEntry = {
      child,
      command,
      args,
      startedAt: new Date().toISOString(),
      exitCode: null,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    };
    this.processes.set(pid, entry);

    logger.info('[process-manager] Launched', { pid, command, args });

    // Capture stdout
    child.stdout?.on('data', (chunk: Buffer) => {
      if (entry.stdoutTruncated) return;
      entry.stdout += chunk.toString();
      if (entry.stdout.length > MAX_OUTPUT_BYTES) {
        entry.stdout = entry.stdout.slice(-MAX_OUTPUT_BYTES);
        entry.stdoutTruncated = true;
      }
    });

    // Capture stderr
    child.stderr?.on('data', (chunk: Buffer) => {
      if (entry.stderrTruncated) return;
      entry.stderr += chunk.toString();
      if (entry.stderr.length > MAX_OUTPUT_BYTES) {
        entry.stderr = entry.stderr.slice(-MAX_OUTPUT_BYTES);
        entry.stderrTruncated = true;
      }
    });

    child.on('exit', (code, signal) => {
      entry.exitCode = code ?? (signal ? -1 : null);
      logger.info('[process-manager] Exited', { pid, command, code, signal });
    });

    child.on('error', (err) => {
      entry.exitCode = -1;
      entry.stderr += `\n[spawn error] ${err.message}`;
      logger.warn('[process-manager] Error', { pid, command, error: String(err) });
    });

    return {
      pid,
      command,
      args,
      startedAt: entry.startedAt,
      running: true,
      exitCode: null,
    };
  }

  list(): ProcessInfo[] {
    return Array.from(this.processes.entries()).map(([pid, entry]) => ({
      pid,
      command: entry.command,
      args: entry.args,
      startedAt: entry.startedAt,
      running: !entry.child.killed && entry.child.exitCode === null,
      exitCode: entry.exitCode,
    }));
  }

  /** Get captured stdout/stderr for a process. */
  getOutput(pid: number, tail?: number): ProcessOutput | null {
    const entry = this.processes.get(pid);
    if (!entry) return null;
    let stdout = entry.stdout;
    let stderr = entry.stderr;
    if (tail && tail > 0) {
      const takeLines = (s: string, n: number) => s.split('\n').slice(-n).join('\n');
      stdout = takeLines(stdout, tail);
      stderr = takeLines(stderr, tail);
    }
    return {
      pid,
      stdout,
      stderr,
      truncated: entry.stdoutTruncated || entry.stderrTruncated,
    };
  }

  kill(pid: number): boolean {
    const entry = this.processes.get(pid);
    if (!entry) return false;

    logger.info('[process-manager] Killing', { pid, command: entry.command });
    entry.child.kill('SIGTERM');

    setTimeout(() => {
      if (!entry.child.killed) {
        entry.child.kill('SIGKILL');
      }
    }, 3000).unref();

    return true;
  }

  /** Wait for a process to exit. Returns exit code or null on timeout. */
  async waitForExit(pid: number, timeoutMs = 30000): Promise<number | null> {
    const entry = this.processes.get(pid);
    if (!entry) return null;
    if (entry.exitCode !== null) return entry.exitCode;

    return new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        resolve(null);
      }, timeoutMs);
      timer.unref();

      entry.child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code ?? -1);
      });
    });
  }

  /** Clean up exited processes older than maxAgeMs. */
  cleanup(maxAgeMs = 300_000): number {
    let removed = 0;
    const now = Date.now();
    for (const [pid, entry] of this.processes) {
      if (entry.exitCode !== null && now - new Date(entry.startedAt).getTime() > maxAgeMs) {
        this.processes.delete(pid);
        removed++;
      }
    }
    return removed;
  }

  killAll(): void {
    for (const [pid] of this.processes) {
      this.kill(pid);
    }
  }
}
