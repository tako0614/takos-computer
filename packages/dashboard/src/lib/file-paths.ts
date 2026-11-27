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

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} M`;
}
