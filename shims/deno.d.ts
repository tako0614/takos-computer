declare namespace Deno {
  type CommandStatus = {
    code: number;
    success: boolean;
    signal: string | null;
  };

  type CommandOutput = CommandStatus & {
    stdout: Uint8Array;
    stderr: Uint8Array;
  };

  type ChildProcess = {
    pid: number;
    status: Promise<CommandStatus>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    stdin?: WritableStream<Uint8Array>;
    kill(signal?: string): boolean | void;
  };

  type FileInfo = {
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    size: number;
    mtime: Date | null;
    atime: Date | null;
    birthtime: Date | null;
    mode: number | null;
  };

  type DirEntry = {
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
  };

  type HttpServer = {
    finished: Promise<void>;
    shutdown(): Promise<void>;
    addr?: unknown;
  };
}

declare const Deno: any;
