export interface BreadcrumbSegment {
  label: string;
  path: string;
  current: boolean;
}

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".bin",
  ".bmp",
  ".bz2",
  ".class",
  ".db",
  ".dll",
  ".dylib",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".pdf",
  ".png",
  ".pyc",
  ".so",
  ".sqlite",
  ".tar",
  ".ttf",
  ".wasm",
  ".wav",
  ".webp",
  ".woff",
  ".woff2",
  ".xz",
  ".zip",
]);

export function parentWorkspaceDirectory(current: string): string {
  // Absolute paths do not reveal the configured jail root to this client.
  if (current.startsWith("/")) return ".";
  const segments: string[] = [];
  for (const segment of current.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      // An unknown path above root cannot establish its relative parent.
      if (!segments.length) return ".";
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  segments.pop();
  return segments.length
    ? `${current.startsWith("./") ? "./" : ""}${segments.join("/")}`
    : ".";
}

export function joinWorkspacePath(cwd: string, name: string): string {
  const current = cwd === "/" ? "/" : cwd.replace(/\/+$/, "") || ".";
  return current === "/" ? `/${name}` : `${current}/${name}`;
}

export function buildBreadcrumbs(rawCwd: string): BreadcrumbSegment[] {
  const trimmed = rawCwd.trim();
  if (!trimmed || trimmed === "." || trimmed === "./") {
    return [{ label: ".", path: ".", current: true }];
  }

  const isAbsolute = trimmed.startsWith("/");
  const dotSlashPrefix = !isAbsolute && trimmed.startsWith("./");
  const normalized: string[] = [];

  for (const part of trimmed.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (normalized.length > 0) normalized.pop();
      continue;
    }
    normalized.push(part);
  }

  if (normalized.length === 0) {
    const root = isAbsolute ? "/" : ".";
    return [{ label: root, path: root, current: true }];
  }

  const rootLabel = isAbsolute ? "/" : ".";
  const rootPath = isAbsolute ? "/" : ".";
  const crumbs: BreadcrumbSegment[] = [
    { label: rootLabel, path: rootPath, current: false },
  ];

  let acc = isAbsolute ? "" : dotSlashPrefix ? "." : "";
  for (let i = 0; i < normalized.length; i++) {
    const segment = normalized[i]!;
    if (isAbsolute) {
      acc = `${acc}/${segment}`;
    } else if (acc) {
      acc = `${acc}/${segment}`;
    } else {
      acc = segment;
    }
    crumbs.push({
      label: segment,
      path: acc,
      current: i === normalized.length - 1,
    });
  }

  return crumbs;
}

export function hasBinaryExtension(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return false;
  return BINARY_EXTENSIONS.has(lower.slice(dot));
}

export function isLikelyBinaryContent(content: string): boolean {
  const sampleLen = Math.min(content.length, 4096);
  if (sampleLen === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < sampleLen; i++) {
    const code = content.charCodeAt(i);
    if (code === 0) return true;
    // Allow tab (9), LF (10), VT (11), FF (12), CR (13)
    if (code < 32 && (code < 9 || code > 13)) {
      suspicious++;
    }
  }
  return suspicious / sampleLen > 0.1;
}

export function isLikelyBinaryFile(name: string, content?: string): boolean {
  if (hasBinaryExtension(name)) return true;
  if (content !== undefined && isLikelyBinaryContent(content)) return true;
  return false;
}

export const FILE_READ_CHUNK_BYTES = 256 * 1024;
export const MAX_IMAGE_PREVIEW_BYTES = 4 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const PREVIEW_IMAGE_MIME_TYPES: Record<string, string> = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function getPreviewImageMimeType(name: string): string | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return null;
  return PREVIEW_IMAGE_MIME_TYPES[lower.slice(dot)] ?? null;
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  if (!base64) return new Uint8Array(new ArrayBuffer(0));
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface ChunkedFileReadChunk {
  content?: string;
  size?: number;
  truncated?: boolean;
}

export type ChunkedReadOutcome =
  | { ok: true; chunks: Uint8Array<ArrayBuffer>[]; size: number }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "too_large"; size: number };

export async function readChunkedBase64File(
  readChunk: (
    offset: number,
    limit: number,
  ) => Promise<ChunkedFileReadChunk | null | undefined>,
  maxBytes: number,
  isCancelled: () => boolean,
  chunkBytes: number = FILE_READ_CHUNK_BYTES,
): Promise<ChunkedReadOutcome> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let totalSize = 0;

  while (true) {
    if (isCancelled()) return { ok: false, reason: "cancelled" };
    const result = await readChunk(offset, chunkBytes);
    if (isCancelled()) return { ok: false, reason: "cancelled" };

    const size = typeof result?.size === "number" && Number.isFinite(result.size)
      ? result.size
      : totalSize;
    totalSize = size;
    if (size > maxBytes) {
      return { ok: false, reason: "too_large", size };
    }

    const content = typeof result?.content === "string" ? result.content : "";
    const bytes = base64ToBytes(content);
    if (bytes.byteLength > 0) {
      chunks.push(bytes);
      offset += bytes.byteLength;
    }

    if (offset > maxBytes) {
      return {
        ok: false,
        reason: "too_large",
        size: Math.max(totalSize, offset),
      };
    }

    if (!result?.truncated) {
      break;
    }

    if (offset >= maxBytes) {
      return {
        ok: false,
        reason: "too_large",
        size: Math.max(totalSize, offset),
      };
    }

    if (bytes.byteLength === 0) {
      throw new Error("Unexpected empty chunk before end of file");
    }
  }

  return { ok: true, chunks, size: Math.max(totalSize, offset) };
}

export function filterFileEntries<T extends { name: string }>(
  entries: readonly T[],
  rawQuery: string,
): T[] {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [...entries];
  const terms = normalized.split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const lowerName = entry.name.toLowerCase();
    return terms.every((term) => lowerName.includes(term));
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} M`;
}
