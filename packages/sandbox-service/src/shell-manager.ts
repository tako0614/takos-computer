/**
 * Shell command execution manager.
 *
 * Runs commands via Deno.Command with configurable timeout and output limits.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_OUTPUT_BYTES = 256 * 1024; // 256 KB per stream
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
  private readonly workspaceRoot: string;
  private readonly defaultCwd: string;
  private workspaceRealRoot: string | null = null;
  private managedProcesses = new Map<number, Deno.ChildProcess>();

  constructor(defaultCwd = "/home/sandbox/workspace") {
    this.workspaceRoot = resolve(defaultCwd);
    this.defaultCwd = this.workspaceRoot;
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
    const timeoutMs = normalizeTimeoutMs(options.timeout_ms);

    let timedOut = false;
    let aborted = false;
    let process: Deno.ChildProcess | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const terminate = (reason: "timeout" | "abort") => {
      if (reason === "timeout") timedOut = true;
      if (reason === "abort") aborted = true;
      if (!process) return;

      try {
        process.kill("SIGTERM");
      } catch {
        // Process may already be gone.
      }

      forceKillTimer = setTimeout(() => {
        try {
          process?.kill("SIGKILL");
        } catch {
          // Process may already be gone.
        }
      }, PROCESS_KILL_GRACE_MS);
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
      const workspaceRoot = await this.getWorkspaceRealRoot();
      const cmd = new Deno.Command("bash", {
        args: [
          "-c",
          WORKSPACE_CWD_GUARD_SCRIPT,
          "takos-shell-manager",
          workspaceRoot,
          options.command,
        ],
        cwd,
        clearEnv: true,
        env: buildCommandEnv(options.env, {
          allowTakosToken: options.allow_takos_token === true,
          takosToken: options.takos_token,
        }),
        stdout: "piped",
        stderr: "piped",
      });

      const child = cmd.spawn() as Deno.ChildProcess;
      process = child;
      this.trackProcess(child);
      if (options.signal?.aborted) externalAbort();

      const [status, stdout, stderr] = await Promise.all([
        child.status,
        collectOutput(child.stdout),
        collectOutput(child.stderr),
      ]);

      return {
        stdout,
        stderr: appendTerminationMessage(stderr, timeoutMs, timedOut, aborted),
        exit_code: timedOut ? 124 : status.code,
        timed_out: timedOut,
      };
    } catch (err) {
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: timedOut ? 124 : 1,
        timed_out: timedOut,
      };
    } finally {
      clearTimeout(timer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener("abort", externalAbort);
    }
  }

  killProcess(
    pid: number,
    signal: ProcessSignal = "SIGTERM",
  ): ProcessKillResult {
    if (!Number.isSafeInteger(pid) || pid <= 1) {
      throw new Error("pid must be a positive integer greater than 1");
    }
    if (!ALLOWED_KILL_SIGNALS.has(signal)) {
      throw new Error(`Unsupported signal: ${signal}`);
    }

    const process = this.managedProcesses.get(pid);
    if (!process) {
      return {
        killed: false,
        pid,
        signal,
        error: "Process is not managed by this ShellManager",
      };
    }

    try {
      process.kill(signal);
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

  private trackProcess(process: Deno.ChildProcess): void {
    this.managedProcesses.set(process.pid, process);
    void process.status.finally(() => {
      if (this.managedProcesses.get(process.pid) === process) {
        this.managedProcesses.delete(process.pid);
      }
    });
  }

  private async resolveCwd(cwd: string): Promise<string> {
    if (!cwd || cwd.includes("\0")) {
      throw new Error("cwd must be a non-empty string");
    }

    const lexicalPath = isAbsolute(cwd)
      ? resolve(cwd)
      : resolve(this.workspaceRoot, cwd);
    this.assertInsideWorkspace(lexicalPath);

    const [workspaceRealRoot, cwdRealPath] = await Promise.all([
      this.getWorkspaceRealRoot(),
      Deno.realPath(lexicalPath),
    ]);
    const resolvedCwd = resolve(cwdRealPath);
    this.assertInsideWorkspace(resolvedCwd, workspaceRealRoot);

    const stat = await Deno.stat(resolvedCwd);
    if (!stat.isDirectory) {
      throw new Error("cwd must be a directory");
    }
    return resolvedCwd;
  }

  private async getWorkspaceRealRoot(): Promise<string> {
    if (!this.workspaceRealRoot) {
      this.workspaceRealRoot = resolve(await Deno.realPath(this.workspaceRoot));
    }
    return this.workspaceRealRoot;
  }

  private assertInsideWorkspace(path: string, root = this.workspaceRoot): void {
    const rel = relative(root, path);
    if (
      rel === "" ||
      (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    ) {
      return;
    }
    throw new Error("cwd is outside workspace");
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
  for (const [key, value] of Object.entries(
    Deno.env.toObject() as Record<string, string>,
  )) {
    if (
      INHERITED_ENV_ALLOWLIST.has(key) &&
      !CONTROL_PLANE_ENV_DENYLIST.has(key)
    ) {
      env[key] = value;
    }
  }
  if (options.allowTakosToken) {
    const takosToken = options.takosToken ?? Deno.env.get("TAKOS_TOKEN");
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

async function collectOutput(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let storedBytes = 0;
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.length;
    if (storedBytes >= MAX_OUTPUT_BYTES) continue;

    const remaining = MAX_OUTPUT_BYTES - storedBytes;
    const chunk = value.length > remaining ? value.slice(0, remaining) : value;
    chunks.push(chunk);
    storedBytes += chunk.length;
  }

  const bytes = new Uint8Array(storedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder().decode(bytes);
  if (totalBytes > MAX_OUTPUT_BYTES) {
    return text + `\n... (truncated, ${totalBytes} bytes total)`;
  }
  return text;
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
