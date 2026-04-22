/**
 * Filesystem operations manager.
 *
 * Provides read, write, list, and info operations with output limits.
 */

import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const MAX_READ_BYTES = 256 * 1024; // 256 KB

export interface FileReadOptions {
  path: string;
  offset?: number;
  limit?: number;
  encoding?: "utf-8" | "base64";
}

export interface FileReadResult {
  content: string;
  size: number;
  truncated: boolean;
}

export interface FileWriteOptions {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
  create_dirs?: boolean;
}

export interface FileWriteResult {
  path: string;
  bytes_written: number;
}

export interface FileListOptions {
  path: string;
  recursive?: boolean;
  glob?: string;
}

export interface FileEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "unknown";
  size: number;
  modified: string | null;
}

export interface FileInfoResult {
  exists: boolean;
  type: "file" | "directory" | "symlink" | "unknown";
  size: number;
  modified: string | null;
  permissions: number | null;
}

export class FsManager {
  private readonly workspaceRoot: string;
  private workspaceRealRoot: string | null = null;

  constructor(workspaceRoot = "/home/sandbox/workspace") {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  async read(
    options: FileReadOptions,
    signal?: AbortSignal,
  ): Promise<FileReadResult> {
    throwIfAborted(signal);

    const path = await this.resolveExistingPath(options.path);
    const stat = await Deno.stat(path);
    const totalSize = stat.size;
    const offset = normalizeOffset(options.offset);
    const limit = normalizeLimit(options.limit);
    const file = await Deno.open(path, { read: true });

    try {
      throwIfAborted(signal);
      if (offset > 0) {
        await file.seek(offset, Deno.SeekMode.Start);
      }

      const buffer = new Uint8Array(limit);
      let bytesRead = 0;
      while (bytesRead < limit) {
        throwIfAborted(signal);
        const n = await file.read(buffer.subarray(bytesRead));
        if (n === null) break;
        bytesRead += n;
      }

      const slice = buffer.slice(0, bytesRead);
      const truncated = offset + bytesRead < totalSize;

      const encoding = options.encoding ?? "utf-8";
      const content = encoding === "base64"
        ? bytesToBase64(slice)
        : new TextDecoder().decode(slice);

      return { content, size: totalSize, truncated };
    } finally {
      file.close();
    }
  }

  async write(
    options: FileWriteOptions,
    signal?: AbortSignal,
  ): Promise<FileWriteResult> {
    throwIfAborted(signal);
    const path = this.resolveLexicalPath(options.path);
    this.assertInsideWorkspace(path);

    if (options.create_dirs) {
      await this.createParentDirs(path);
    }
    throwIfAborted(signal);
    await this.assertWritableTarget(path);

    const encoding = options.encoding ?? "utf-8";
    let data: Uint8Array;
    if (encoding === "base64") {
      const binary = atob(options.content);
      data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        data[i] = binary.charCodeAt(i);
      }
    } else {
      data = new TextEncoder().encode(options.content);
    }

    throwIfAborted(signal);
    await Deno.writeFile(path, data);
    return { path, bytes_written: data.length };
  }

  async list(
    options: FileListOptions,
    signal?: AbortSignal,
  ): Promise<FileEntry[]> {
    throwIfAborted(signal);
    const entries: FileEntry[] = [];
    const maxEntries = 1000;
    const path = await this.resolveExistingPath(options.path);

    if (options.recursive) {
      await this.walkDir(
        path,
        entries,
        maxEntries,
        options.glob,
        signal,
      );
    } else {
      for await (const entry of Deno.readDir(path)) {
        throwIfAborted(signal);
        if (entries.length >= maxEntries) break;
        if (options.glob && !matchGlob(entry.name, options.glob)) continue;

        const fullPath = join(path, entry.name);
        const stat = await safeLstatFile(fullPath);
        entries.push({
          name: entry.name,
          type: entry.isFile
            ? "file"
            : entry.isDirectory
            ? "directory"
            : entry.isSymlink
            ? "symlink"
            : "unknown",
          size: stat?.size ?? 0,
          modified: stat?.mtime?.toISOString() ?? null,
        });
      }
    }
    return entries;
  }

  async info(path: string): Promise<FileInfoResult> {
    try {
      const resolvedPath = await this.resolveExistingPath(path);
      const stat = await Deno.lstat(resolvedPath);
      return {
        exists: true,
        type: stat.isFile
          ? "file"
          : stat.isDirectory
          ? "directory"
          : stat.isSymlink
          ? "symlink"
          : "unknown",
        size: stat.size,
        modified: stat.mtime?.toISOString() ?? null,
        permissions: stat.mode,
      };
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return {
          exists: false,
          type: "unknown",
          size: 0,
          modified: null,
          permissions: null,
        };
      }
      throw err;
    }
  }

  private resolveLexicalPath(path: string): string {
    if (!path || path.includes("\0")) {
      throw new Error("path must be a non-empty string");
    }
    return isAbsolute(path) ? resolve(path) : resolve(this.workspaceRoot, path);
  }

  private async getWorkspaceRealRoot(): Promise<string> {
    if (!this.workspaceRealRoot) {
      this.workspaceRealRoot = resolve(await Deno.realPath(this.workspaceRoot));
    }
    return this.workspaceRealRoot;
  }

  private assertInsideWorkspace(path: string, root = this.workspaceRoot): void {
    const rel = relative(root, path);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
    throw new Error("path is outside workspace");
  }

  private async resolveExistingPath(path: string): Promise<string> {
    const lexicalPath = this.resolveLexicalPath(path);
    this.assertInsideWorkspace(lexicalPath);
    const [realRoot, realPath] = await Promise.all([
      this.getWorkspaceRealRoot(),
      Deno.realPath(lexicalPath),
    ]);
    this.assertInsideWorkspace(resolve(realPath), realRoot);
    return resolve(realPath);
  }

  private async assertWritableTarget(path: string): Promise<void> {
    const realRoot = await this.getWorkspaceRealRoot();
    const parentRealPath = resolve(await Deno.realPath(dirname(path)));
    this.assertInsideWorkspace(parentRealPath, realRoot);

    try {
      const info = await Deno.lstat(path);
      if (info.isSymlink) {
        throw new Error("refusing to write through symlink");
      }
      const realPath = resolve(await Deno.realPath(path));
      this.assertInsideWorkspace(realPath, realRoot);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return;
      throw err;
    }
  }

  private async createParentDirs(path: string): Promise<void> {
    const parent = dirname(path);
    this.assertInsideWorkspace(parent);

    const realRoot = await this.getWorkspaceRealRoot();
    let nearestExisting = parent;
    while (true) {
      try {
        const info = await Deno.lstat(nearestExisting);
        if (info.isSymlink) {
          const realPath = resolve(await Deno.realPath(nearestExisting));
          this.assertInsideWorkspace(realPath, realRoot);
          const realInfo = await Deno.stat(realPath);
          if (!realInfo.isDirectory) {
            throw new Error("parent path is not a directory");
          }
          break;
        }
        if (!info.isDirectory) {
          throw new Error("parent path is not a directory");
        }
        const realPath = resolve(await Deno.realPath(nearestExisting));
        this.assertInsideWorkspace(realPath, realRoot);
        break;
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
        const next = dirname(nearestExisting);
        if (next === nearestExisting) throw err;
        nearestExisting = next;
      }
    }

    await Deno.mkdir(parent, { recursive: true });
    const parentRealPath = resolve(await Deno.realPath(parent));
    this.assertInsideWorkspace(parentRealPath, realRoot);
  }

  private async walkDir(
    dir: string,
    entries: FileEntry[],
    maxEntries: number,
    glob?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    if (entries.length >= maxEntries) return;
    for await (const entry of Deno.readDir(dir)) {
      throwIfAborted(signal);
      if (entries.length >= maxEntries) return;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        await this.walkDir(fullPath, entries, maxEntries, glob, signal);
      } else {
        if (glob && !matchGlob(entry.name, glob)) continue;
        const stat = await safeLstatFile(fullPath);
        entries.push({
          name: fullPath,
          type: entry.isFile ? "file" : entry.isSymlink ? "symlink" : "unknown",
          size: stat?.size ?? 0,
          modified: stat?.mtime?.toISOString() ?? null,
        });
      }
    }
  }
}

async function safeLstatFile(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch {
    return null;
  }
}

/** Simple glob matching (supports * and ?). */
function matchGlob(name: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(name);
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }
  return offset;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return MAX_READ_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error("limit must be a non-negative integer");
  }
  return Math.min(limit, MAX_READ_BYTES);
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Operation aborted", "AbortError");
}
