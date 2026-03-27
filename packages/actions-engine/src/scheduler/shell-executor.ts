/**
 * Shell command execution
 */
import { spawn } from 'node:child_process';

import type { Step } from '../types.js';
import type { ShellExecutor, ShellExecutorOptions, ShellExecutorResult } from './step-types.js';

export function resolvePlatformDefaultShell(): Step['shell'] {
  return process.platform === 'win32' ? 'pwsh' : 'bash';
}

/**
 * Resolve shell name to executable
 */
export function resolveShellExecutable(shell: Step['shell'] | undefined): string | true {
  if (!shell) {
    return true;
  }

  switch (shell) {
    case 'cmd':
      return process.platform === 'win32' ? 'cmd.exe' : 'cmd';
    case 'powershell':
      return process.platform === 'win32' ? 'powershell.exe' : 'powershell';
    default:
      return shell;
  }
}

function appendStderrMessage(stderr: string, message: string): string {
  return stderr.length > 0 ? `${stderr}\n${message}` : message;
}

/**
 * Default shell executor
 */
export const defaultShellExecutor: ShellExecutor = async (
  command: string,
  options: ShellExecutorOptions
): Promise<ShellExecutorResult> => {
  return new Promise<ShellExecutorResult>((resolve, reject) => {
    const shellExecutable = resolveShellExecutable(options.shell);

    // Always invoke the shell as a separate binary with the command passed as
    // an argument so that shell: false can be used and user-supplied content in
    // `command` is never interpreted as a shell command name.
    let spawnFile: string;
    let spawnArgs: string[];

    if (shellExecutable === true) {
      // No explicit shell requested – fall back to the platform default shell
      // but still spawn it explicitly with shell: false.
      if (process.platform === 'win32') {
        spawnFile = 'cmd.exe';
        spawnArgs = ['/d', '/s', '/c', command];
      } else {
        spawnFile = '/bin/sh';
        spawnArgs = ['-c', command];
      }
    } else {
      // An explicit shell binary was resolved (bash, powershell, cmd.exe, …).
      if (shellExecutable === 'cmd.exe' || shellExecutable === 'cmd') {
        spawnArgs = ['/d', '/s', '/c', command];
      } else if (
        shellExecutable === 'powershell.exe' ||
        shellExecutable === 'powershell' ||
        shellExecutable === 'pwsh'
      ) {
        spawnArgs = ['-NonInteractive', '-Command', command];
      } else {
        // Generic POSIX-compatible shell (bash, sh, zsh, …)
        spawnArgs = ['-c', command];
      }
      spawnFile = shellExecutable;
    }

    // Only pass safe host environment variables to prevent leaking secrets.
    // Workflow-level env vars are provided via options.env.
    const safeHostEnv: Record<string, string> = {};
    const ALLOWED_HOST_VARS = [
      'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
      'TERM', 'TMPDIR', 'TMP', 'TEMP', 'HOSTNAME',
      'NODE_ENV', 'CI',
    ];
    for (const key of ALLOWED_HOST_VARS) {
      if (process.env[key]) {
        safeHostEnv[key] = process.env[key]!;
      }
    }

    const child = spawn(spawnFile, spawnArgs, {
      cwd: options.workingDirectory,
      env: {
        ...safeHostEnv,
        ...(options.env ?? {}),
      },
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout =
      typeof options.timeout === 'number' && options.timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, options.timeout)
        : undefined;

    timeout?.unref?.();

    child.stdout?.on('data', (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      const exitCode =
        typeof code === 'number' ? code : timedOut ? 124 : signal ? 128 : 1;

      if (timedOut) {
        const timeoutMessage = `Command timed out after ${options.timeout}ms`;
        stderr = appendStderrMessage(stderr, timeoutMessage);
      } else if (signal) {
        const signalMessage = `Process terminated by signal: ${signal}`;
        stderr = appendStderrMessage(stderr, signalMessage);
      }

      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
};
