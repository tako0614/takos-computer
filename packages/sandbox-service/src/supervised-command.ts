import { Buffer } from "node:buffer";
import { env as processEnv } from "node:process";
import { fileURLToPath } from "node:url";
import type { ProcessSignal } from "./shell-manager.ts";

const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_STATUS_FRAME = 16 * 1024;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SupervisedCommand {
  readonly started: Promise<number>;
  readonly result: Promise<CommandResult>;
  readonly cleaned: Promise<number>;
  readonly closed: Promise<void>;
  launch(): void;
  signal(signal: ProcessSignal): void;
}

class OutputBuffer {
  private chunks: Uint8Array[] = [];
  private size = 0;

  append(encoded: unknown): void {
    if (typeof encoded !== "string" || encoded.length > 10924) throw new Error();
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length > 8192 || bytes.toString("base64") !== encoded ||
      this.size + bytes.length > MAX_OUTPUT_BYTES) throw new Error();
    this.chunks.push(bytes);
    this.size += bytes.length;
  }

  text(total: unknown): string {
    if (!Number.isSafeInteger(total) || Number(total) < this.size ||
      this.size !== Math.min(Number(total), MAX_OUTPUT_BYTES)) throw new Error();
    const text = new TextDecoder().decode(Buffer.concat(this.chunks, this.size));
    return Number(total) > MAX_OUTPUT_BYTES
      ? text + `\n... (truncated, ${total} bytes total)` : text;
  }
}

export function spawnSupervisedCommand(options: {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  graceMs: number;
  completionDeadlineMs: number;
}): SupervisedCommand {
  const python = Bun.which("python3");
  if (!python) throw new Error("python3 is required for sandbox process supervision");
  // Use standard pipes only. Bun 1.3.14's Node-compatible extra stdio FDs can
  // close a later command's reused FD during garbage collection.
  const child = Bun.spawn([python, "-I", "-S", "-u",
    fileURLToPath(new URL("./command-supervisor.py", import.meta.url))], {
    cwd: options.cwd,
    env: { PATH: processEnv.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    stdin: "pipe", stdout: "pipe", stderr: "ignore",
  });
  const started = deferred<number>();
  const result = deferred<CommandResult>();
  const cleaned = deferred<number>();
  const closed = deferred<void>();
  const stdout = new OutputBuffer();
  const stderr = new OutputBuffer();
  let pid: number | undefined;
  let done: CommandResult | undefined;
  let exited = false;
  let statusEnded = false;
  let exitCode: number | null = null;
  let fatal: Error | undefined;
  const fail = (message: string, protocol = false) => {
    const error = new Error(message);
    if (protocol) fatal ??= error;
    started.reject(error);
    result.reject(error);
    clearTimeout(watchdog);
  };
  const write = (message: object) => {
    if (exited) return;
    try {
      child.stdin.write(JSON.stringify(message) + "\n");
      void Promise.resolve(child.stdin.flush()).catch(() => {
        if (!exited) fail("Command supervision control was lost", true);
      });
    } catch {
      if (!exited) fail("Command supervision control was lost", true);
    }
  };
  const watchdog = setTimeout(() => {
    fail("Command supervision did not confirm cleanup");
    write({ signal: "SIGKILL" });
  }, options.completionDeadlineMs);
  const settle = () => {
    if (!exited || !statusEnded) return;
    clearTimeout(watchdog);
    child.stdin.end();
    if (!fatal && pid !== undefined && done && exitCode === done.exitCode) {
      cleaned.resolve(done.exitCode);
      result.resolve(done);
    } else {
      const error = fatal ?? new Error("Command supervisor exited without confirming cleanup");
      started.reject(error);
      result.reject(error);
      cleaned.reject(error);
    }
    closed.resolve();
  };
  const packet = (line: string) => {
    if (line.length > MAX_STATUS_FRAME) throw new Error();
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object" || done) throw new Error();
    const data = value as Record<string, unknown>;
    const keys = Object.keys(data).length;
    if (data.type === "started" && keys === 2 && pid === undefined &&
      Number.isSafeInteger(data.pid) && Number(data.pid) > 1) {
      pid = Number(data.pid);
      started.resolve(pid);
    } else if (data.type === "output" && keys === 3 && pid !== undefined &&
      (data.stream === "stdout" || data.stream === "stderr")) {
      (data.stream === "stdout" ? stdout : stderr).append(data.data);
    } else if (data.type === "done" && keys === 4 && pid !== undefined &&
      Number.isInteger(data.exit_code) && Number(data.exit_code) >= 0 && Number(data.exit_code) <= 255) {
      done = { exitCode: Number(data.exit_code),
        stdout: stdout.text(data.stdout_bytes), stderr: stderr.text(data.stderr_bytes) };
    } else if (data.type === "error" && keys === 2 && typeof data.message === "string" &&
      data.message.length <= 256) {
      fail(data.message);
    } else throw new Error();
  };
  void (async () => {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        while (buffer.includes("\n")) {
          const offset = buffer.indexOf("\n");
          const line = buffer.slice(0, offset);
          buffer = buffer.slice(offset + 1);
          packet(line);
        }
        if (buffer.length > MAX_STATUS_FRAME) throw new Error();
      }
      buffer += decoder.decode();
      if (buffer) throw new Error();
    } catch {
      fail("Invalid command supervision response", true);
      write({ signal: "SIGKILL" });
      // Closing the protocol reader also tells the helper to keep ownership
      // and drain its family after a failed write, never to acknowledge success.
      await reader.cancel().catch(() => {});
    } finally {
      reader.releaseLock();
      statusEnded = true;
      settle();
    }
  })();
  void child.exited.then((code) => { exited = true; exitCode = code; settle(); }, () => {
    exited = true;
    fail("Command supervisor could not finish", true);
    settle();
  });
  write({ version: 1, argv: options.argv, cwd: options.cwd, env: options.env, grace_ms: options.graceMs });
  return {
    started: started.promise, result: result.promise,
    cleaned: cleaned.promise, closed: closed.promise,
    launch() { write({ start: true }); },
    signal(signal) { write({ signal }); },
  };
}
