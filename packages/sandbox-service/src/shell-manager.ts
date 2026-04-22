/**
 * Shell command execution manager.
 *
 * Runs commands via Deno.Command with configurable timeout and output limits.
 */

const MAX_OUTPUT_BYTES = 256 * 1024; // 256 KB per stream
const PROCESS_KILL_GRACE_MS = 1_000;
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
  "TAKOS_TOKEN",
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
  private defaultCwd: string;

  constructor(defaultCwd = "/home/sandbox/workspace") {
    this.defaultCwd = defaultCwd;
  }

  async exec(options: ShellExecOptions): Promise<ShellExecResult> {
    const timeoutMs = normalizeTimeoutMs(options.timeout_ms);
    const cwd = options.cwd ?? this.defaultCwd;

    let timedOut = false;
    let aborted = false;
    let process: Deno.ChildProcess | null = null;
    let forceKillTimer: number | undefined;

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
      const cmd = new Deno.Command("bash", {
        args: ["-c", options.command],
        cwd,
        clearEnv: true,
        env: buildCommandEnv(options.env),
        stdout: "piped",
        stderr: "piped",
      });

      process = cmd.spawn();
      if (options.signal?.aborted) externalAbort();

      const [status, stdout, stderr] = await Promise.all([
        process.status,
        collectOutput(process.stdout),
        collectOutput(process.stderr),
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

    try {
      Deno.kill(pid, signal);
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
}

function buildCommandEnv(
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (
      INHERITED_ENV_ALLOWLIST.has(key) &&
      !CONTROL_PLANE_ENV_DENYLIST.has(key)
    ) {
      env[key] = value;
    }
  }
  if (!overrides) return env;

  for (const [key, value] of Object.entries(overrides)) {
    validateOverrideEnv(key, value);
    env[key] = value;
  }
  return env;
}

function validateOverrideEnv(
  key: string,
  value: unknown,
): asserts value is string {
  if (!ENV_NAME_PATTERN.test(key)) {
    throw new Error(`Invalid environment variable name: ${key}`);
  }
  if (typeof value !== "string") {
    throw new Error(`Environment variable value must be a string: ${key}`);
  }
  if (CONTROL_PLANE_ENV_DENYLIST.has(key) || isSensitiveOverrideEnv(key)) {
    throw new Error(`Sensitive environment variable is not allowed: ${key}`);
  }
  if (value.length > MAX_ENV_VALUE_LENGTH) {
    throw new Error(`Environment variable value too long: ${key}`);
  }
  if (value.includes("\0") || value.includes("\r") || value.includes("\n")) {
    throw new Error(`Environment variable contains invalid characters: ${key}`);
  }
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
