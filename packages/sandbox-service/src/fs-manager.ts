/**
 * Filesystem operations manager.
 *
 * Provides read, write, list, and info operations with output limits.
 */

import { dirname, join, resolve } from "node:path";
import type { Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { isNotFoundError, WorkspaceJail } from "./workspace-jail.ts";

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
  private readonly jail: WorkspaceJail;

  constructor(workspaceRoot = "/home/sandbox/workspace") {
    this.jail = new WorkspaceJail(workspaceRoot, { noun: "path" });
  }

  async read(
    options: FileReadOptions,
    signal?: AbortSignal,
  ): Promise<FileReadResult> {
    throwIfAborted(signal);

    const path = await this.jail.resolveExistingPath(options.path);
    const info = await stat(path);
    const totalSize = info.size;
    const offset = normalizeOffset(options.offset);
    const limit = normalizeLimit(options.limit);
    const file = await open(path, "r");

    try {
      throwIfAborted(signal);
      const buffer = Buffer.alloc(limit);
      let bytesRead = 0;
      while (bytesRead < limit) {
        throwIfAborted(signal);
        const { bytesRead: n } = await file.read(
          buffer,
          bytesRead,
          limit - bytesRead,
          offset + bytesRead,
        );
        if (n === 0) break;
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
      await file.close();
    }
  }

  async write(
    options: FileWriteOptions,
    signal?: AbortSignal,
  ): Promise<FileWriteResult> {
    throwIfAborted(signal);
    const path = this.jail.resolveLexicalPath(options.path);
    this.jail.assertInsideWorkspace(path);

    if (options.create_dirs) {
      await this.createParentDirs(path);
    }
    throwIfAborted(signal);
    await this.jail.assertWritable(path);

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
    await writeFile(path, data);
    return { path, bytes_written: data.length };
  }

  async list(
    options: FileListOptions,
    signal?: AbortSignal,
  ): Promise<FileEntry[]> {
    throwIfAborted(signal);
    const entries: FileEntry[] = [];
    const maxEntries = 1000;
    const path = await this.jail.resolveExistingPath(options.path);

    if (options.recursive) {
      await this.walkDir(
        path,
        entries,
        maxEntries,
        options.glob,
        signal,
      );
    } else {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        throwIfAborted(signal);
        if (entries.length >= maxEntries) break;
        if (options.glob && !matchGlob(entry.name, options.glob)) continue;

        const fullPath = join(path, entry.name);
        const stat = await safeLstatFile(fullPath);
        entries.push({
          name: entry.name,
          type: entry.isFile()
            ? "file"
            : entry.isDirectory()
            ? "directory"
            : entry.isSymbolicLink()
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
      const resolvedPath = await this.jail.resolveExistingPath(path);
      const stat = await lstat(resolvedPath);
      return {
        exists: true,
        type: stat.isFile()
          ? "file"
          : stat.isDirectory()
          ? "directory"
          : stat.isSymbolicLink()
          ? "symlink"
          : "unknown",
        size: stat.size,
        modified: stat.mtime?.toISOString() ?? null,
        permissions: stat.mode,
      };
    } catch (err) {
      if (isNotFoundError(err)) {
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

  private async createParentDirs(path: string): Promise<void> {
    const parent = dirname(path);
    this.jail.assertInsideWorkspace(parent);

    const realRoot = await this.jail.getWorkspaceRealRoot();
    let nearestExisting = parent;
    while (true) {
      try {
        const info = await lstat(nearestExisting);
        if (info.isSymbolicLink()) {
          const realPath = resolve(await realpath(nearestExisting));
          this.jail.assertInsideWorkspace(realPath, realRoot);
          const realInfo = await stat(realPath);
          if (!realInfo.isDirectory()) {
            throw new Error("parent path is not a directory");
          }
          break;
        }
        if (!info.isDirectory()) {
          throw new Error("parent path is not a directory");
        }
        const realPath = resolve(await realpath(nearestExisting));
        this.jail.assertInsideWorkspace(realPath, realRoot);
        break;
      } catch (err) {
        if (!isNotFoundError(err)) throw err;
        const next = dirname(nearestExisting);
        if (next === nearestExisting) throw err;
        nearestExisting = next;
      }
    }

    await mkdir(parent, { recursive: true });
    const parentRealPath = resolve(await realpath(parent));
    this.jail.assertInsideWorkspace(parentRealPath, realRoot);
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
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      throwIfAborted(signal);
      if (entries.length >= maxEntries) return;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.walkDir(fullPath, entries, maxEntries, glob, signal);
      } else {
        if (glob && !matchGlob(entry.name, glob)) continue;
        const stat = await safeLstatFile(fullPath);
        entries.push({
          name: fullPath,
          type: entry.isFile()
            ? "file"
            : entry.isSymbolicLink()
            ? "symlink"
            : "unknown",
          size: stat?.size ?? 0,
          modified: stat?.mtime?.toISOString() ?? null,
        });
      }
    }
  }
}

async function safeLstatFile(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
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
