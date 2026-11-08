/**
 * Shell command execution manager.
 *
 * Runs commands through Bun subprocesses with configurable timeout and output
 * limits.
 */

import { env as processEnv } from "node:process";
import { spawnSupervisedCommand, type SupervisedCommand } from "./supervised-command.ts";
import { stat } from "node:fs/promises";
import { WorkspaceJail } from "./workspace-jail.ts";

const PROCESS_KILL_GRACE_MS = 1_000;
const WORKSPACE_CWD_GUARD_SCRIPT = [
  'workspace_root="$1"',
  'user_command="$2"',
  'current_cwd="$(pwd -P)" || exit 1',
  'case "$current_cwd" in',
  '  "$workspace_root"|"$workspace_root"/*) ;;',
  '  *) echo "cwd is outside workspace" >&2; exit 1 ;;',
  "esac",
  'exec bash -c "$user_command"',
].join("\n");
const CONTROL_PLANE_ENV_DENYLIST = new Set([
  "MCP_AUTH_TOKEN",
  "SANDBOX_HOST_AUTH_TOKEN",
  "MCP_ALLOW_UNAUTHENTICATED",
]);
const INHERITED_ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LANGUAGE",
  "TZ",
  "COLORTERM",
  "FORCE_COLOR",
  "NO_COLOR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "DENO_DIR",
  "NPM_CONFIG_REGISTRY",
  "CI",
  "TAKOS_API_URL",
  "TAKOS_SPACE_ID",
  "TAKOS_REPO_ID",
  "TAKOS_SESSION_ID",
]);
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ENV_VALUE_LENGTH = 128 * 1024;
const SENSITIVE_OVERRIDE_PATTERNS = [
  /SECRET/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /PRIVATE/i,
  /AUTH/i,
  /TOKEN$/i,
  /^TAKOS_/i,
  /API[_-]?KEY/i,
];

export type ProcessSignal =
  | "SIGHUP"
  | "SIGINT"
  | "SIGTERM"
  | "SIGKILL"
  | "SIGUSR1"
  | "SIGUSR2";

const ALLOWED_KILL_SIGNALS = new Set<ProcessSignal>([
  "SIGHUP",
  "SIGINT",
  "SIGTERM",
  "SIGKILL",
  "SIGUSR1",
  "SIGUSR2",
]);

export interface ShellExecOptions {
  command: string;
  timeout_ms?: number;
  cwd?: string;
  env?: Record<string, string>;
  allow_takos_token?: boolean;
  takos_token?: string;
  signal?: AbortSignal;
}

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

export interface ProcessKillResult {
  killed: boolean;
  pid: number;
  signal: ProcessSignal;
  error?: string;
}

export class ShellManager {
  private readonly jail: WorkspaceJail;
  private readonly defaultCwd: string;
  private managedProcesses = new Map<number, TrackedProcess>();

  constructor(defaultCwd = "/home/sandbox/workspace") {
    this.jail = new WorkspaceJail(defaultCwd, { noun: "cwd" });
    this.defaultCwd = this.jail.workspaceRoot;
  }

  async exec(options: ShellExecOptions): Promise<ShellExecResult> {
    if (
      options.takos_token !== undefined && options.allow_takos_token !== true
    ) {
      return {
        stdout: "",
        stderr: "takos_token requires allow_takos_token",
        exit_code: 1,
        timed_out: false,
      };
    }
    if (
      options.allow_takos_token === true && options.takos_token === undefined
    ) {
      return {
        stdout: "",
        stderr:
          "allow_takos_token requires an explicit per-request takos_token",
        exit_code: 1,
        timed_out: false,
      };
    }
    const timeoutMs = normalizeTimeoutMs(options.timeout_ms);

    let timedOut = false;
    let aborted = false;
    let process: SupervisedCommand | null = null;
    const began = performance.now();

    const terminate = (reason: "timeout" | "abort") => {
      if (reason === "timeout") timedOut = true;
      if (reason === "abort") aborted = true;
      if (!process) return;

      process.signal("SIGTERM");
    };

    const timer = setTimeout(() => terminate("timeout"), timeoutMs);
    const externalAbort = () => terminate("abort");
    if (options.signal?.aborted) {
      externalAbort();
    } else {
      options.signal?.addEventListener("abort", externalAbort, { once: true });
    }

    try {
      const cwd = await this.resolveCwd(options.cwd ?? this.defaultCwd);
      const workspaceRoot = await this.jail.getWorkspaceRealRoot();
      const commandArgv = [
        "bash",
        "-c",
        WORKSPACE_CWD_GUARD_SCRIPT,
        "takos-shell-manager",
        workspaceRoot,
        options.command,
      ];
      // The dedicated supervisor reserves the command PID until its family is
      // collected. `setsid -w` preserves the public command PID/process group;
      // the supervisor also collects descendants which create other sessions.
      const setsid = setsidPath();
      if (!setsid) {
        throw new Error("setsid is required for sandbox process isolation");
      }
      if (timedOut || aborted) {
        return {
          stdout: "", stderr: appendTerminationMessage("", timeoutMs, timedOut, aborted),
          exit_code: timedOut ? 124 : 1, timed_out: timedOut,
        };
      }
      const child = spawnSupervisedCommand({
        argv: [setsid, "-w", ...commandArgv],
        cwd,
        env: buildCommandEnv(options.env, {
          allowTakosToken: options.allow_takos_token === true,
          takosToken: options.takos_token,
        }),
        graceMs: PROCESS_KILL_GRACE_MS,
        completionDeadlineMs: Math.max(1, timeoutMs - (performance.now() - began) + PROCESS_KILL_GRACE_MS + 250),
      });
      process = child;
      const pid = await child.started;
      this.trackProcess(pid, child);
      if (options.signal?.aborted) externalAbort();
      else if (timedOut) child.signal("SIGTERM");
      child.launch();
      const { exitCode, stdout, stderr } = await child.result;

      return {
        stdout,
        stderr: appendTerminationMessage(stderr, timeoutMs, timedOut, aborted),
        exit_code: timedOut ? 124 : exitCode,
        timed_out: timedOut,
      };
    } catch (err) {
      if (process) {
        process.signal("SIGKILL");
      }
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: timedOut ? 124 : 1,
        timed_out: timedOut,
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", externalAbort);
    }
  }

  killProcess(
    pid: number,
    signal: ProcessSignal = "SIGTERM",
  ): Promise<ProcessKillResult> {
    if (!Number.isSafeInteger(pid) || pid <= 1) {
      throw new Error("pid must be a positive integer greater than 1");
    }
    if (!ALLOWED_KILL_SIGNALS.has(signal)) {
      throw new Error(`Unsupported signal: ${signal}`);
    }

    const tracked = this.managedProcesses.get(pid);
    if (!tracked) {
      return Promise.resolve({
        killed: false,
        pid,
        signal,
        error: "Process is not managed by this ShellManager",
      });
    }

    return this.killTrackedProcess(tracked, pid, signal);
  }

  private async killTrackedProcess(
    tracked: TrackedProcess,
    pid: number,
    signal: ProcessSignal,
  ): Promise<ProcessKillResult> {
    try {
      tracked.process.signal(signal);
      const exited = await Promise.race([
        tracked.process.cleaned.then(() => true),
        delay(PROCESS_KILL_GRACE_MS + 250).then(() => false),
      ]);
      if (!exited) {
        return { killed: false, pid, signal, error: "Managed descendants did not finish cleanup" };
      }
      return { killed: true, pid, signal };
    } catch (err) {
      return {
        killed: false,
        pid,
        signal,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private trackProcess(pid: number, process: SupervisedCommand): void {
    if (this.managedProcesses.has(pid)) throw new Error("Managed process PID is still reserved");
    this.managedProcesses.set(pid, { process });
    void process.closed.then(() => {
      if (this.managedProcesses.get(pid)?.process === process) {
        this.managedProcesses.delete(pid);
      }
    });
  }

  private async resolveCwd(cwd: string): Promise<string> {
    const resolvedCwd = await this.jail.resolveExistingPath(cwd);
    const info = await stat(resolvedCwd);
    if (!info.isDirectory()) {
      throw new Error("cwd must be a directory");
    }
    return resolvedCwd;
  }
}

function buildCommandEnv(
  overrides: Record<string, string> | undefined,
  options: {
    allowTakosToken: boolean;
    takosToken?: string;
  },
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;
    if (
      INHERITED_ENV_ALLOWLIST.has(key) &&
      !CONTROL_PLANE_ENV_DENYLIST.has(key)
    ) {
      env[key] = value;
    }
  }
  if (options.allowTakosToken) {
    const takosToken = options.takosToken;
    if (takosToken !== undefined) {
      validateDirectEnv("TAKOS_TOKEN", takosToken);
      env.TAKOS_TOKEN = takosToken;
    }
  }
  if (!overrides) return env;

  for (const [key, value] of Object.entries(overrides)) {
    validateOverrideEnv(key, value);
    env[key] = value;
  }
  return env;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type TrackedProcess = { readonly process: SupervisedCommand };

type BunLike = {
  which(command: string): string | null;
};

function bunLike(): BunLike {
  const bun = (globalThis as { Bun?: BunLike }).Bun;
  if (!bun) throw new Error("Bun runtime is required for shell execution");
  return bun;
}

let cachedSetsidPath: string | null | undefined;

/**
 * Resolve `setsid` on the server PATH before applying caller overrides.
 * When present, commands run as their own
 * session/process-group leader so the whole group can be killed on
 * timeout/abort. Shell execution fails closed when it is unavailable.
 */
function setsidPath(): string | null {
  if (cachedSetsidPath === undefined) {
    cachedSetsidPath = bunLike().which("setsid");
  }
  return cachedSetsidPath;
}

function assertSafeEnvShape(
  key: string,
  value: unknown,
): asserts value is string {
  if (!ENV_NAME_PATTERN.test(key)) {
    throw new Error(`Invalid environment variable name: ${key}`);
  }
  if (typeof value !== "string") {
    throw new Error(`Environment variable value must be a string: ${key}`);
  }
  if (value.length > MAX_ENV_VALUE_LENGTH) {
    throw new Error(`Environment variable value too long: ${key}`);
  }
  if (value.includes("\0") || value.includes("\r") || value.includes("\n")) {
    throw new Error(`Environment variable contains invalid characters: ${key}`);
  }
}

function validateOverrideEnv(
  key: string,
  value: unknown,
): asserts value is string {
  // Override env comes from untrusted caller input, so it must reject
  // denylisted and pattern-sensitive keys in addition to shape validation.
  if (CONTROL_PLANE_ENV_DENYLIST.has(key) || isSensitiveOverrideEnv(key)) {
    throw new Error(`Sensitive environment variable is not allowed: ${key}`);
  }
  assertSafeEnvShape(key, value);
}

function validateDirectEnv(
  key: string,
  value: unknown,
): asserts value is string {
  assertSafeEnvShape(key, value);
}

function isSensitiveOverrideEnv(key: string): boolean {
  for (const pattern of SENSITIVE_OVERRIDE_PATTERNS) {
    if (pattern.test(key)) {
      return true;
    }
  }
  return false;
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (
    timeoutMs === undefined || !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return 30_000;
  }
  return Math.floor(timeoutMs);
}

function appendTerminationMessage(
  stderr: string,
  timeoutMs: number,
  timedOut: boolean,
  aborted: boolean,
): string {
  if (timedOut) {
    return stderr +
      `${stderr ? "\n" : ""}Command timed out after ${timeoutMs}ms`;
  }
  if (aborted) {
    return stderr + `${stderr ? "\n" : ""}Command aborted`;
  }
  return stderr;
}
