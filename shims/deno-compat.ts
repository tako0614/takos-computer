// Bun migration: minimal, self-installing `globalThis.Deno` runtime compat.
//
// Implements the RUNTIME subset of the Deno namespace this CLI uses, backed by
// Bun / node: APIs. Importing this module installs the global as a side effect
// (idempotent). It does NOT provide `Deno.test` (that is test-only and added by
// shims/deno-test-preload.ts) and deliberately omits the Deno permission model
// (no Node/Bun equivalent).
//
// This is the canonical pattern reused across the ecosystem's Bun migration.
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";

type StdioStr = "piped" | "inherit" | "null";

function mapStdio(v: StdioStr | undefined): "pipe" | "inherit" | "ignore" {
  if (v === "inherit") return "inherit";
  if (v === "null") return "ignore";
  return "pipe";
}

interface CommandOptions {
  args?: string[];
  cwd?: string | URL;
  env?: Record<string, string>;
  clearEnv?: boolean;
  stdin?: StdioStr;
  stdout?: StdioStr;
  stderr?: StdioStr;
  signal?: AbortSignal;
}

interface CommandOutput {
  code: number;
  signal: string | null;
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

function buildEnv(opts: CommandOptions): NodeJS.ProcessEnv {
  if (opts.clearEnv) return { ...(opts.env ?? {}) };
  return { ...process.env, ...(opts.env ?? {}) };
}

class DenoCommand {
  #cmd: string;
  #opts: CommandOptions;
  constructor(cmd: string | URL, opts: CommandOptions = {}) {
    this.#cmd = cmd instanceof URL ? cmd.pathname : cmd;
    this.#opts = opts;
  }

  output(): Promise<CommandOutput> {
    const o = this.#opts;
    return new Promise((resolve, reject) => {
      const child = spawn(this.#cmd, o.args ?? [], {
        cwd: o.cwd instanceof URL ? o.cwd.pathname : o.cwd,
        env: buildEnv(o),
        stdio: [mapStdio(o.stdin), mapStdio(o.stdout ?? "piped"), mapStdio(o.stderr ?? "piped")],
        signal: o.signal,
      });
      const out: Uint8Array[] = [];
      const err: Uint8Array[] = [];
      child.stdout?.on("data", (c: Buffer) => out.push(c));
      child.stderr?.on("data", (c: Buffer) => err.push(c));
      child.on("error", reject);
      child.on("close", (code, sig) => {
        resolve({
          code: code ?? 0,
          signal: sig,
          success: (code ?? 0) === 0,
          stdout: out.length ? new Uint8Array(Buffer.concat(out)) : new Uint8Array(),
          stderr: err.length ? new Uint8Array(Buffer.concat(err)) : new Uint8Array(),
        });
      });
    });
  }

  outputSync(): CommandOutput {
    const o = this.#opts;
    const r = spawnSync(this.#cmd, o.args ?? [], {
      cwd: o.cwd instanceof URL ? o.cwd.pathname : o.cwd,
      env: buildEnv(o),
      stdio: [mapStdio(o.stdin), mapStdio(o.stdout ?? "piped"), mapStdio(o.stderr ?? "piped")],
    });
    return {
      code: r.status ?? 0,
      signal: r.signal,
      success: (r.status ?? 0) === 0,
      stdout: r.stdout ? new Uint8Array(r.stdout) : new Uint8Array(),
      stderr: r.stderr ? new Uint8Array(r.stderr) : new Uint8Array(),
    };
  }

  spawn() {
    const o = this.#opts;
    const child = spawn(this.#cmd, o.args ?? [], {
      cwd: o.cwd instanceof URL ? o.cwd.pathname : o.cwd,
      env: buildEnv(o),
      stdio: [mapStdio(o.stdin), mapStdio(o.stdout), mapStdio(o.stderr)],
      signal: o.signal,
    });
    // Deno's ChildProcess exposes stdout/stderr as web ReadableStream and stdin
    // as a web WritableStream; consumers call .getReader()/.getWriter(). Adapt
    // the node streams (only present when the matching stdio is "piped").
    // Buffer chunks EAGERLY at spawn time rather than lazily in the stream's
    // start(). Under `bun test`, the test runner intercepts child stdio and a
    // short-lived child can emit+end its node stream before a lazily-attached
    // consumer (ShellManager calls getReader() only after closing stdin), which
    // dropped output. Attaching the data listener synchronously here captures it
    // regardless of when the web-stream consumer attaches.
    const toReadable = (
      ns: NodeJS.ReadableStream | null,
    ): ReadableStream<Uint8Array> | null => {
      if (!ns) return null;
      const chunks: Uint8Array[] = [];
      let ended = false;
      let errored: unknown = null;
      let wake: (() => void) | null = null;
      const signal = () => {
        const w = wake;
        wake = null;
        w?.();
      };
      ns.on("data", (c: Buffer) => {
        chunks.push(new Uint8Array(c));
        signal();
      });
      ns.on("end", () => {
        ended = true;
        signal();
      });
      ns.on("error", (e) => {
        errored = e;
        ended = true;
        signal();
      });
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          while (chunks.length === 0 && !ended) {
            await new Promise<void>((res) => (wake = res));
          }
          if (chunks.length > 0) {
            controller.enqueue(chunks.shift()!);
            return;
          }
          if (errored) controller.error(errored);
          else controller.close();
        },
        cancel() {
          (ns as { destroy?: () => void }).destroy?.();
        },
      });
    };
    const toWritable = (
      nw: NodeJS.WritableStream | null,
    ): WritableStream<Uint8Array> | null => {
      if (!nw) return null;
      return new WritableStream<Uint8Array>({
        write(chunk) {
          return new Promise((res, rej) => {
            nw.write(chunk, (e) => (e ? rej(e) : res()));
          });
        },
        close() {
          return new Promise((res) => (nw as { end: (cb: () => void) => void }).end(res));
        },
      });
    };
    const status = new Promise<
      { code: number; success: boolean; signal: string | null }
    >((res) =>
      child.on(
        "close",
        (code, sig) => res({ code: code ?? 0, success: (code ?? 0) === 0, signal: sig }),
      )
    );
    return {
      pid: child.pid,
      stdout: toReadable(child.stdout),
      stderr: toReadable(child.stderr),
      stdin: toWritable(child.stdin),
      status,
      output: () => status.then(() => ({})),
      kill: (sig?: NodeJS.Signals) => child.kill(sig),
      unref: () => child.unref?.(),
      ref: () => child.ref?.(),
    };
  }
}

class NotFound extends Error {
  override name = "NotFound";
}
class AlreadyExists extends Error {
  override name = "AlreadyExists";
}
class PermissionDenied extends Error {
  override name = "PermissionDenied";
}

function remap(e: unknown): unknown {
  const code = (e as { code?: string })?.code;
  if (code === "ENOENT") return Object.assign(new NotFound((e as Error).message), { cause: e });
  if (code === "EEXIST") return Object.assign(new AlreadyExists((e as Error).message), { cause: e });
  if (code === "EACCES" || code === "EPERM") return Object.assign(new PermissionDenied((e as Error).message), { cause: e });
  return e;
}

interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

const DenoCompat = {
  args: process.argv.slice(2),
  pid: process.pid,
  build: {
    os: (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : process.platform) as string,
    arch: process.arch,
  },
  errors: { NotFound, AlreadyExists, PermissionDenied },

  env: {
    get: (k: string): string | undefined => process.env[k],
    set: (k: string, v: string): void => {
      process.env[k] = v;
    },
    has: (k: string): boolean => k in process.env,
    delete: (k: string): void => {
      delete process.env[k];
    },
    toObject: (): Record<string, string> => ({ ...process.env } as Record<string, string>),
  },

  exit: (code = 0): never => process.exit(code) as never,
  cwd: (): string => process.cwd(),
  chdir: (dir: string | URL): void => process.chdir(dir instanceof URL ? dir.pathname : dir),
  execPath: (): string => process.execPath,

  addSignalListener: (sig: NodeJS.Signals, handler: () => void): void => {
    process.on(sig, handler);
  },
  removeSignalListener: (sig: NodeJS.Signals, handler: () => void): void => {
    process.off(sig, handler);
  },

  readTextFile: (p: string | URL): Promise<string> =>
    fsp.readFile(p, "utf8").catch((e) => Promise.reject(remap(e))),
  readTextFileSync: (p: string | URL): string => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch (e) {
      throw remap(e);
    }
  },
  readFile: (p: string | URL): Promise<Uint8Array> =>
    fsp.readFile(p).then((b) => new Uint8Array(b)).catch((e) => Promise.reject(remap(e))),

  writeTextFile: (
    p: string | URL,
    data: string,
    opts?: { append?: boolean; create?: boolean; mode?: number },
  ): Promise<void> => fsp.writeFile(p, data, { flag: opts?.append ? "a" : "w", mode: opts?.mode }),
  writeTextFileSync: (
    p: string | URL,
    data: string,
    opts?: { append?: boolean; create?: boolean; mode?: number },
  ): void => fs.writeFileSync(p, data, { flag: opts?.append ? "a" : "w", mode: opts?.mode }),
  writeFile: (p: string | URL, data: Uint8Array, opts?: { mode?: number }): Promise<void> =>
    fsp.writeFile(p, data, { mode: opts?.mode }),
  writeFileSync: (p: string | URL, data: Uint8Array, opts?: { mode?: number }): void =>
    fs.writeFileSync(p, data, { mode: opts?.mode }),

  mkdir: (p: string | URL, opts?: { recursive?: boolean; mode?: number }): Promise<void> =>
    fsp.mkdir(p, { recursive: opts?.recursive, mode: opts?.mode }).then(() => undefined),
  remove: (p: string | URL, opts?: { recursive?: boolean }): Promise<void> =>
    fsp.rm(p, { recursive: opts?.recursive ?? false, force: false }).catch((e) => Promise.reject(remap(e))),
  removeSync: (p: string | URL, opts?: { recursive?: boolean }): void => {
    try {
      fs.rmSync(p, { recursive: opts?.recursive ?? false, force: false });
    } catch (e) {
      throw remap(e);
    }
  },

  makeTempDir: (opts?: { dir?: string; prefix?: string }): Promise<string> =>
    fsp.mkdtemp(path.join(opts?.dir ?? os.tmpdir(), opts?.prefix ?? "")),
  makeTempDirSync: (opts?: { dir?: string; prefix?: string }): string =>
    fs.mkdtempSync(path.join(opts?.dir ?? os.tmpdir(), opts?.prefix ?? "")),
  makeTempFile: async (opts?: { dir?: string; prefix?: string; suffix?: string }): Promise<string> => {
    const dir = opts?.dir ?? os.tmpdir();
    const p = path.join(dir, `${opts?.prefix ?? ""}${crypto.randomUUID()}${opts?.suffix ?? ""}`);
    await fsp.writeFile(p, "");
    return p;
  },
  makeTempFileSync: (opts?: { dir?: string; prefix?: string; suffix?: string }): string => {
    const dir = opts?.dir ?? os.tmpdir();
    const p = path.join(dir, `${opts?.prefix ?? ""}${crypto.randomUUID()}${opts?.suffix ?? ""}`);
    fs.writeFileSync(p, "");
    return p;
  },

  stat: (p: string | URL) =>
    fsp.stat(p).then(toFileInfo).catch((e) => Promise.reject(remap(e))),
  statSync: (p: string | URL) => {
    try {
      return toFileInfo(fs.statSync(p));
    } catch (e) {
      throw remap(e);
    }
  },
  lstat: (p: string | URL) =>
    fsp.lstat(p).then(toFileInfo).catch((e) => Promise.reject(remap(e))),

  readDir: async function* (p: string | URL): AsyncIterable<DirEntry> {
    let ents: fs.Dirent[];
    try {
      ents = await fsp.readdir(p, { withFileTypes: true });
    } catch (e) {
      throw remap(e);
    }
    for (const e of ents) {
      yield { name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory(), isSymlink: e.isSymbolicLink() };
    }
  },

  copyFile: (from: string | URL, to: string | URL): Promise<void> =>
    fsp.copyFile(from, to).catch((e) => Promise.reject(remap(e))),
  rename: (from: string | URL, to: string | URL): Promise<void> =>
    fsp.rename(from, to).catch((e) => Promise.reject(remap(e))),
  symlink: (
    target: string | URL,
    p: string | URL,
    opts?: { type?: "file" | "dir" | "junction" },
  ): Promise<void> =>
    fsp.symlink(target, p, opts?.type === "dir" ? "dir" : opts?.type)
      .catch((e) => Promise.reject(remap(e))),
  chmod: (p: string | URL, mode: number): Promise<void> =>
    fsp.chmod(p, mode).catch((e) => Promise.reject(remap(e))),
  // realPath must remap ENOENT -> Deno.errors.NotFound: callers (fs-manager's
  // resolveExistingPath) rely on `instanceof Deno.errors.NotFound` to convert a
  // missing path into a clean "File not found". Bare fsp.realpath throws a raw
  // node Error, which slipped past the guard.
  realPath: (p: string | URL): Promise<string> =>
    fsp.realpath(p).catch((e) => Promise.reject(remap(e))),

  // Deno.open returns a FsFile. takos-computer's fs-manager uses read()
  // (returns bytes-read or null at EOF), seek(), write(), and close().
  SeekMode: { Start: 0, Current: 1, End: 2 },
  open: async (
    p: string | URL,
    opts?: {
      read?: boolean;
      write?: boolean;
      append?: boolean;
      create?: boolean;
      createNew?: boolean;
      truncate?: boolean;
    },
  ) => {
    let flags = "r";
    if (opts?.write && opts?.read) flags = opts?.createNew ? "wx+" : opts?.create === false ? "r+" : "w+";
    else if (opts?.write) flags = opts?.append ? "a" : opts?.createNew ? "wx" : "w";
    else if (opts?.append) flags = "a";
    let fh: fsp.FileHandle;
    try {
      fh = await fsp.open(p, flags);
    } catch (e) {
      throw remap(e);
    }
    return makeFsFile(fh);
  },
  create: async (p: string | URL) => makeFsFile(await fsp.open(p, "w+")),

  Command: DenoCommand,
};

function makeFsFile(fh: fsp.FileHandle) {
  let pos = 0;
  return {
    async read(buf: Uint8Array): Promise<number | null> {
      const { bytesRead } = await fh.read(buf, 0, buf.byteLength, pos);
      if (bytesRead === 0) return null;
      pos += bytesRead;
      return bytesRead;
    },
    async write(buf: Uint8Array): Promise<number> {
      const { bytesWritten } = await fh.write(buf, 0, buf.byteLength, pos);
      pos += bytesWritten;
      return bytesWritten;
    },
    seek(offset: number | bigint, whence: number): Promise<number> {
      const off = Number(offset);
      if (whence === 0) pos = off;
      else if (whence === 1) pos += off;
      else pos = off; // End: best-effort (size unknown here)
      return Promise.resolve(pos);
    },
    truncate(len?: number): Promise<void> {
      return fh.truncate(len);
    },
    stat: () => fh.stat().then(toFileInfo),
    close(): void {
      void fh.close();
    },
    get readable(): ReadableStream<Uint8Array> {
      return fh.readableWebStream() as unknown as ReadableStream<Uint8Array>;
    },
  };
}

function toFileInfo(s: fs.Stats) {
  return {
    isFile: s.isFile(),
    isDirectory: s.isDirectory(),
    isSymlink: s.isSymbolicLink(),
    size: s.size,
    mtime: s.mtime,
    atime: s.atime,
    birthtime: s.birthtime,
    mode: s.mode,
  };
}

// Idempotent install: merge onto any pre-existing partial Deno (e.g. real Deno,
// or the test preload that adds Deno.test on top of this runtime).
const g = globalThis as unknown as { Deno?: Record<string, unknown> };
g.Deno = Object.assign({}, DenoCompat, g.Deno ?? {});

// HTTP/WebSocket surface for the takos-computer sandbox container entry points
// (Deno.serve in local-dev-simulator / app entry). Not exercised by bun:test
// (server entry is never imported by a *.test.ts), but lets the container run on
// `bun`. Backed by Bun.serve. Upstream candidate for the canonical shim.
type DenoServeHandler = (req: Request, info?: unknown) => Response | Promise<Response>;
interface DenoServeOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  onListen?: (addr: { hostname: string; port: number }) => void;
}
const BunRef = (globalThis as Record<string, unknown>).Bun as
  | { serve: (opts: Record<string, unknown>) => { hostname: string; port: number; stop?: () => void; upgrade?: (req: Request, opts?: unknown) => boolean } }
  | undefined;
(g.Deno as Record<string, unknown>).serve = (
  a: DenoServeOptions | DenoServeHandler,
  b?: DenoServeHandler,
) => {
  const opts: DenoServeOptions = typeof a === "function" ? {} : a;
  const handler: DenoServeHandler = (typeof a === "function" ? a : b)!;
  if (!BunRef) throw new Error("Deno.serve shim requires the Bun runtime");
  const server = BunRef.serve({
    port: opts.port ?? 8000,
    hostname: opts.hostname ?? "0.0.0.0",
    signal: opts.signal,
    websocket: {
      message(ws: { data?: { onmessage?: (e: unknown) => void } }, msg: unknown) {
        ws.data?.onmessage?.({ data: msg });
      },
      open(ws: { data?: { onopen?: () => void } }) {
        ws.data?.onopen?.();
      },
      close(ws: { data?: { onclose?: () => void } }) {
        ws.data?.onclose?.();
      },
    },
    fetch: (req: Request, srv: unknown) => {
      (req as unknown as Record<string, unknown>).__bunServer = srv;
      return handler(req, {});
    },
  });
  opts.onListen?.({
    hostname: server.hostname ?? opts.hostname ?? "0.0.0.0",
    port: server.port ?? opts.port ?? 8000,
  });
  return {
    finished: Promise.resolve(),
    shutdown: () => {
      server.stop?.();
      return Promise.resolve();
    },
    addr: { hostname: server.hostname, port: server.port },
  };
};
(g.Deno as Record<string, unknown>).upgradeWebSocket = (req: Request) => {
  const srv = (req as unknown as { __bunServer?: { upgrade?: (req: Request, o?: unknown) => boolean } }).__bunServer;
  const data: Record<string, unknown> = {};
  const socket = {
    readyState: 0,
    send: (_m: unknown) => {},
    close: () => {},
    set onopen(fn: () => void) {
      data.onopen = fn;
    },
    set onmessage(fn: (e: unknown) => void) {
      data.onmessage = fn;
    },
    set onclose(fn: () => void) {
      data.onclose = fn;
    },
    set onerror(_fn: (e: unknown) => void) {},
  };
  const ok = srv?.upgrade?.(req, { data });
  const response = ok
    ? new Response(null, { status: 101 })
    : new Response("upgrade failed", { status: 426 });
  return { socket, response };
};

export {};
