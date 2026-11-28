import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  setLanguage,
  t,
  type TranslationKey,
} from "../packages/dashboard/src/i18n.ts";
import {
  applyThemeToDocument,
  detectInitialTheme,
  parseThemePreference,
  THEME_STORAGE_KEY,
} from "../packages/dashboard/src/lib/theme.ts";
import {
  base64ToBytes,
  buildBreadcrumbs,
  filterFileEntries,
  formatFileSize,
  getPreviewImageMimeType,
  isLikelyBinaryFile,
  joinWorkspacePath,
  parentWorkspaceDirectory,
  readChunkedBase64File,
} from "../packages/dashboard/src/lib/file-paths.ts";
import {
  countSessionsByStatus,
  filterSessions,
} from "../packages/dashboard/src/lib/session-filter.ts";
import {
  attachDialogTrap,
  getOpenDialogCount,
} from "../packages/dashboard/src/lib/dialog-a11y.ts";
import { ApiError } from "../packages/dashboard/src/lib/api.ts";
import {
  formatAbsoluteTime,
  formatClockTime,
  formatRelativeTime,
} from "../packages/dashboard/src/lib/format-time.ts";
import {
  checkNewFileTargetInfo,
  MAX_SESSION_ID_BYTES,
  pushShellHistory,
  stepShellHistory,
  validateCreateSessionInput,
  validateNewFileName,
} from "../packages/dashboard/src/lib/validation.ts";
import {
  highlightShellLines,
  stepShellSearchMatch,
} from "../packages/dashboard/src/lib/shell-output.ts";
import {
  resolveViewerStatusKey,
  shouldAnnounceViewerStatus,
  shouldShowViewerStatusLoading,
} from "../packages/dashboard/src/lib/viewer-status.ts";

const DASHBOARD_DIR = new URL("../packages/dashboard/", import.meta.url);

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(clean.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function parseTokens(cssBlock: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (
    const match of cssBlock.matchAll(/(--tc-[a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)
  ) {
    tokens[match[1]!] = match[2]!.toLowerCase();
  }
  return tokens;
}

test("dashboard i18n translates key UI labels in both en and ja with interpolation", () => {
  const keys: TranslationKey[] = [
    "appTitle",
    "skipToContent",
    "refreshSessions",
    "refreshStatus",
    "shell",
    "shellCommandInput",
    "shellOutput",
    "clear",
    "clearFilter",
    "clearSearch",
    "close",
    "confirm",
    "destroySessionTitle",
    "directoryBreadcrumbs",
    "directoryPath",
    "discard",
    "discardChangesTitle",
    "dismiss",
    "fileContents",
    "keepEditing",
    "noMatchingSessions",
    "noMatchingSessionsHint",
    "noSessionsHint",
    "parentDirectory",
    "processNotManaged",
    "readOnly",
    "reload",
    "retry",
    "run",
    "running",
    "save",
    "saveShortcutHint",
    "saving",
    "searchSessions",
    "searchSessionsPlaceholder",
    "sessionCountOne",
    "sessionListUnavailable",
    "statusUnavailable",
    "stop",
    "stopProcess",
    "stopProcessTitle",
    "stopping",
    "theme",
    "themeDark",
    "themeLight",
    "themeSystem",
    "unconfirmedDestroyCurrent",
    "backToSessions",
    "checking",
    "copied",
    "copyFailed",
    "copyOutput",
    "copyPath",
    "createFileTitle",
    "createFirstSession",
    "directoryAlreadyExists",
    "fileAlreadyExists",
    "fileExistsCheckFailed",
    "fileNameHint",
    "fileNameLabel",
    "fileNamePlaceholder",
    "fileReloaded",
    "modified",
    "newFile",
    "newFileBadge",
    "notFound",
    "notFoundDescription",
    "notFoundHeading",
    "notFoundTitle",
    "outputCopied",
    "pathCopied",
    "sessionNotFoundHint",
    "sessionNotFoundTitle",
    "symlink",
    "unsavedChanges",
    "user",
    "validationFileNameInvalid",
    "validationFileNameRequired",
    "validationRequired",
    "validationSessionIdInvalid",
    "workspaceRoot",
    "workspaceRootLabel",
    "autoRefreshPaused",
    "clearFileFilter",
    "download",
    "downloading",
    "fileCountOne",
    "filterByStatus",
    "filterFiles",
    "filterFilesPlaceholder",
    "noMatchingFiles",
    "noMatchingFilesHint",
    "pauseAutoRefresh",
    "resumeAutoRefresh",
    "statusActive",
    "statusAll",
    "statusStarting",
    "statusStopped",
    "closeSearch",
    "command",
    "cpuMem",
    "findInOutput",
    "nextMatch",
    "noMatches",
    "pid",
    "previousMatch",
    "processCountOne",
    "searchShellOutput",
    "searchShellOutputPlaceholder",
    "wrapLines",
  ];

  for (const lang of ["en", "ja"] as const) {
    setLanguage(lang);
    for (const key of keys) {
      expect(t(key).trim().length).toBeGreaterThan(0);
    }
    expect(t("cpuMemLabel", { cpu: "1.2", mem: "3.4" })).toContain("1.2");
    expect(t("downloadFailed", { message: "network" })).toContain("network");
    expect(t("downloadTooLarge", { size: "30.0 M", max: "20.0 M" })).toContain(
      "20.0 M",
    );
    expect(t("fileCount", { count: 12 })).toContain("12");
    expect(t("fileMatchCount", { shown: 2, total: 12 })).toContain("12");
    expect(t("imagePreviewFailed", { size: "4.0 K" })).toContain("4.0 K");
    expect(t("imageTooLargeNotice", { size: "8.0 M", max: "4.0 M" }))
      .toContain("4.0 M");
    expect(t("lastUpdated", { time: "12:34:56" })).toContain("12:34:56");
    expect(t("validationSessionIdReserved", { prefix: "pmcp-" })).toContain(
      "pmcp-",
    );
    expect(t("validationSessionIdTooLong", { max: 120 })).toContain("120");
    expect(t("deleteSessionAria", { id: "s-01" })).toContain("s-01");
    expect(t("unconfirmedDestroySession", { id: "s-01" })).toContain("s-01");
    expect(t("openFileAria", { name: "app.ts" })).toContain("app.ts");
    expect(t("fileSaved", { bytes: 42 })).toContain("42");
    expect(t("saveFailed", { message: "disk full" })).toContain("disk full");
    expect(t("binaryFileNotice", { size: "12.0 K" })).toContain("12.0 K");
    expect(t("truncatedFileNotice", { size: "1.2 M" })).toContain("1.2 M");
    expect(t("discardChangesConfirm", { name: "a.txt" })).toContain("a.txt");
    expect(t("linesCount", { count: 7 })).toContain("7");
    expect(t("sessionCount", { count: 3 })).toContain("3");
    expect(t("sessionMatchCount", { shown: 1, total: 4 })).toContain("1");
    expect(t("sessionMatchCount", { shown: 1, total: 4 })).toContain("4");
    expect(t("stopProcessAria", { pid: 99, command: "sleep 10" })).toContain(
      "99",
    );
    expect(t("stopProcessConfirm", { pid: 99 })).toContain("99");
    expect(t("processStopped", { pid: 99 })).toContain("99");
    expect(t("stopProcessFailed", { pid: 99, message: "denied" })).toContain(
      "denied",
    );
    expect(t("processCount", { count: 4 })).toContain("4");
    expect(t("searchMatchCount", { current: 2, total: 9 })).toContain("2");
    expect(t("searchMatchCountCapped", { current: 1, total: 2000 })).toContain(
      "2000+",
    );
    expect(t("sessionStatusAnnouncement", { status: t("active") })).toContain(
      t("active"),
    );
  }
  setLanguage("en");
});

test("dashboard CSS tokens meet WCAG AA (>= 4.5:1) contrast in dark and light themes", () => {
  const css = readFileSync(new URL("src/styles.css", DASHBOARD_DIR), "utf8");
  const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
  expect(lightStart).toBeGreaterThan(0);

  const darkTokens = parseTokens(css.slice(0, lightStart));
  const lightMediaEnd = css.indexOf("\n}\n", lightStart + 100);
  const lightMediaTokens = parseTokens(css.slice(lightStart, lightMediaEnd));
  const lightTokens = {
    ...darkTokens,
    ...lightMediaTokens,
  };

  const explicitLightStart = css.indexOf(':root[data-theme="light"]');
  expect(explicitLightStart).toBeGreaterThan(lightMediaEnd);
  const explicitLightEnd = css.indexOf("\n}\n", explicitLightStart);
  const explicitLightTokens = parseTokens(
    css.slice(explicitLightStart, explicitLightEnd),
  );
  expect(explicitLightTokens).toEqual(lightMediaTokens);

  for (
    const [mode, tokens] of [
      ["dark", darkTokens],
      ["light", lightTokens],
    ] as const
  ) {
    const pairs: Array<[string, string, string]> = [
      ["fg on bg", tokens["--tc-fg"]!, tokens["--tc-bg"]!],
      ["fg on surface", tokens["--tc-fg"]!, tokens["--tc-surface"]!],
      ["fg-muted on bg", tokens["--tc-fg-muted"]!, tokens["--tc-bg"]!],
      [
        "fg-muted on surface",
        tokens["--tc-fg-muted"]!,
        tokens["--tc-surface"]!,
      ],
      [
        "accent-fg on accent",
        tokens["--tc-accent-fg"]!,
        tokens["--tc-accent"]!,
      ],
      [
        "danger-fg on danger",
        tokens["--tc-danger-fg"]!,
        tokens["--tc-danger"]!,
      ],
      [
        "danger-ghost-fg on surface",
        tokens["--tc-danger-ghost-fg"]!,
        tokens["--tc-surface"]!,
      ],
      ["dir-fg on surface", tokens["--tc-dir-fg"]!, tokens["--tc-surface"]!],
      [
        "status-fg on status-bg",
        tokens["--tc-status-fg"]!,
        tokens["--tc-status-bg"]!,
      ],
      [
        "info-fg on info-bg",
        tokens["--tc-info-fg"]!,
        tokens["--tc-info-bg"]!,
      ],
      [
        "badge-active",
        tokens["--tc-badge-active-fg"]!,
        tokens["--tc-badge-active-bg"]!,
      ],
      [
        "badge-starting",
        tokens["--tc-badge-starting-fg"]!,
        tokens["--tc-badge-starting-bg"]!,
      ],
      [
        "badge-stopped",
        tokens["--tc-badge-stopped-fg"]!,
        tokens["--tc-badge-stopped-bg"]!,
      ],
      [
        "term-fg on term-bg",
        tokens["--tc-term-fg"]!,
        tokens["--tc-term-bg"]!,
      ],
      [
        "term-muted on term-bg",
        tokens["--tc-term-muted"]!,
        tokens["--tc-term-bg"]!,
      ],
      [
        "term-prompt on term-bg",
        tokens["--tc-term-prompt"]!,
        tokens["--tc-term-bg"]!,
      ],
      [
        "term-fatal on term-bg",
        tokens["--tc-term-fatal"]!,
        tokens["--tc-term-bg"]!,
      ],
      [
        "term-match-fg on term-match-bg",
        tokens["--tc-term-match-fg"]!,
        tokens["--tc-term-match-bg"]!,
      ],
      [
        "term-match-active-fg on term-match-active-bg",
        tokens["--tc-term-match-active-fg"]!,
        tokens["--tc-term-match-active-bg"]!,
      ],
    ];
    for (const [label, fg, bg] of pairs) {
      const ratio = contrastRatio(fg, bg);
      expect(ratio, `${mode} ${label} (${fg} on ${bg})`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  }

  // Banner button contrast: .status-banner .btn-ghost inherits --tc-status-fg on
  // --tc-status-bg (already verified >= 4.5:1 above), and .alert-banner-row/.panel-error
  // .btn-ghost renders --tc-alert-fg over --tc-alert-bg (composited over --tc-bg in dark mode).
  expect(css).toContain(".status-banner .btn-ghost {\n  color: inherit;");
  expect(css).toContain(
    ".alert-banner-row .btn-ghost,\n.panel-error .btn-ghost {\n  color: var(--tc-alert-fg);",
  );
  expect(contrastRatio(lightTokens["--tc-alert-fg"]!, lightTokens["--tc-alert-bg"]!))
    .toBeGreaterThanOrEqual(4.5);
  // Dark --tc-alert-bg is rgba(127, 29, 29, 0.35) over --tc-bg (#0f172a) -> #381823.
  expect(contrastRatio(darkTokens["--tc-alert-fg"]!, "#381823"))
    .toBeGreaterThanOrEqual(4.5);
  // Status filter chips: inactive --tc-fg-muted on --tc-surface-subtle meets WCAG AA.
  expect(
    contrastRatio(darkTokens["--tc-fg-muted"]!, darkTokens["--tc-surface-subtle"]!),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(lightTokens["--tc-fg-muted"]!, lightTokens["--tc-surface-subtle"]!),
  ).toBeGreaterThanOrEqual(4.5);
});

test("dashboard index.html includes favicon, color-scheme, theme-color, and pre-hydration theme guard", () => {
  const html = readFileSync(new URL("index.html", DASHBOARD_DIR), "utf8");
  expect(html).toContain('<meta name="theme-color" content="#0f172a">');
  expect(html).toContain('<meta name="color-scheme" content="dark light">');
  expect(html).toContain(
    '<link rel="icon" type="image/png" href="/gui/icons/icon-192.png">',
  );
  expect(html).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
  expect(html).toContain('html[data-theme="light"]');
  expect(html).toContain('html[data-theme="dark"]');
});

test("theme helpers normalize values and toggle document dataset cleanly", () => {
  expect(parseThemePreference("light")).toBe("light");
  expect(parseThemePreference("dark")).toBe("dark");
  expect(parseThemePreference("system")).toBe("system");
  expect(parseThemePreference("sepia")).toBe("system");
  expect(parseThemePreference(null)).toBe("system");

  expect(
    detectInitialTheme({
      getItem: (key) => (key === THEME_STORAGE_KEY ? "light" : null),
    }),
  ).toBe("light");
  expect(
    detectInitialTheme({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
  ).toBe("system");

  const doc = {
    documentElement: { dataset: {} as Record<string, string | undefined> },
  } as unknown as Document;
  applyThemeToDocument("light", doc);
  expect(doc.documentElement.dataset.theme).toBe("light");
  applyThemeToDocument("dark", doc);
  expect(doc.documentElement.dataset.theme).toBe("dark");
  applyThemeToDocument("system", doc);
  expect(doc.documentElement.dataset.theme).toBeUndefined();
});

test("file path helpers build clickable breadcrumbs and detect binary files", () => {
  expect(buildBreadcrumbs(".")).toEqual([
    { label: ".", path: ".", current: true },
  ]);
  expect(buildBreadcrumbs("./src/lib")).toEqual([
    { label: ".", path: ".", current: false },
    { label: "src", path: "./src", current: false },
    { label: "lib", path: "./src/lib", current: true },
  ]);
  expect(buildBreadcrumbs("a/b/c/")).toEqual([
    { label: ".", path: ".", current: false },
    { label: "a", path: "a", current: false },
    { label: "b", path: "a/b", current: false },
    { label: "c", path: "a/b/c", current: true },
  ]);
  expect(buildBreadcrumbs("/workspace/sub")).toEqual([
    { label: "/", path: "/", current: false },
    { label: "workspace", path: "/workspace", current: false },
    { label: "sub", path: "/workspace/sub", current: true },
  ]);

  expect(joinWorkspacePath(".", "hello.txt")).toBe("./hello.txt");
  expect(joinWorkspacePath("./sub/", "a.md")).toBe("./sub/a.md");
  expect(joinWorkspacePath("/", "etc")).toBe("/etc");
  expect(parentWorkspaceDirectory("./a/b")).toBe("./a");
  expect(parentWorkspaceDirectory("/abs/path")).toBe(".");

  expect(isLikelyBinaryFile("icon.png")).toBe(true);
  expect(isLikelyBinaryFile("archive.tar.gz")).toBe(true);
  expect(isLikelyBinaryFile("README.md", "# Hello\nworld\n")).toBe(false);
  expect(isLikelyBinaryFile("data.raw", "abc\u0000def")).toBe(true);
  expect(formatFileSize(512)).toBe("512 B");
  expect(formatFileSize(2048)).toBe("2.0 K");
  expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 M");

  expect(getPreviewImageMimeType("photo.PNG")).toBe("image/png");
  expect(getPreviewImageMimeType("avatar.jpg")).toBe("image/jpeg");
  expect(getPreviewImageMimeType("banner.webp")).toBe("image/webp");
  expect(getPreviewImageMimeType("icon.ico")).toBe("image/x-icon");
  expect(getPreviewImageMimeType("vector.svg")).toBeNull();
  expect(getPreviewImageMimeType("notes.txt")).toBeNull();
  expect(getPreviewImageMimeType(".png")).toBeNull();

  expect(Array.from(base64ToBytes(""))).toEqual([]);
  expect(Array.from(base64ToBytes(btoa("hello")))).toEqual([
    104,
    101,
    108,
    108,
    111,
  ]);
  expect(Array.from(base64ToBytes("AAEC/w=="))).toEqual([0, 1, 2, 255]);

  const files = [
    { name: "src", type: "directory" as const },
    { name: "README.md", type: "file" as const },
    { name: "log-01.txt", type: "file" as const },
    { name: "log-10-error.txt", type: "file" as const },
  ];
  expect(filterFileEntries(files, "")).toHaveLength(4);
  expect(filterFileEntries(files, "readme").map((f) => f.name)).toEqual([
    "README.md",
  ]);
  expect(filterFileEntries(files, "log error").map((f) => f.name)).toEqual([
    "log-10-error.txt",
  ]);
  expect(filterFileEntries(files, "missing")).toEqual([]);
});

test("readChunkedBase64File handles multi-chunk reads, concurrent growth, empty truncated chunks, and cancellation", async () => {
  // Multi-chunk byte-exact reassembly
  const multiChunks = [
    { content: btoa("hello "), size: 11, truncated: true },
    { content: btoa("world"), size: 11, truncated: false },
  ];
  let idx = 0;
  const okOutcome = await readChunkedBase64File(
    async () => multiChunks[idx++]!,
    32,
    () => false,
    6,
  );
  expect(okOutcome.ok).toBe(true);
  if (okOutcome.ok) {
    const merged = new Uint8Array(
      okOutcome.chunks.reduce((acc, c) => acc + c.byteLength, 0),
    );
    let pos = 0;
    for (const c of okOutcome.chunks) {
      merged.set(c, pos);
      pos += c.byteLength;
    }
    expect(new TextDecoder().decode(merged)).toBe("hello world");
    expect(okOutcome.size).toBe(11);
  }

  // Reported size exceeds maxBytes -> too_large without decoding content
  const reportedLarge = await readChunkedBase64File(
    async () => ({ content: btoa("abc"), size: 100, truncated: true }),
    10,
    () => false,
    4,
  );
  expect(reportedLarge).toEqual({ ok: false, reason: "too_large", size: 100 });

  // Concurrent growth with missing/stale size: truncated=true when offset >= maxBytes -> too_large
  const grownCalls = [
    { content: btoa("1234"), size: 8, truncated: true },
    { content: btoa("5678"), size: 8, truncated: true },
  ];
  let grownIdx = 0;
  const grownOutcome = await readChunkedBase64File(
    async () => grownCalls[grownIdx++]!,
    8,
    () => false,
    4,
  );
  expect(grownOutcome).toEqual({ ok: false, reason: "too_large", size: 8 });

  // Single chunk exceeding maxBytes when size is omitted -> too_large
  const oversizeChunk = await readChunkedBase64File(
    async () => ({ content: btoa("123456"), truncated: false }),
    4,
    () => false,
    6,
  );
  expect(oversizeChunk).toEqual({ ok: false, reason: "too_large", size: 6 });

  // Concurrent shrink / empty chunk while truncated=true -> throws instead of silent partial read
  await expect(
    readChunkedBase64File(
      async () => ({ content: "", size: 10, truncated: true }),
      32,
      () => false,
      4,
    ),
  ).rejects.toThrow("Unexpected empty chunk");

  // Cancellation mid-stream
  let calls = 0;
  const cancelledOutcome = await readChunkedBase64File(
    async () => {
      calls++;
      return { content: btoa("ab"), size: 6, truncated: true };
    },
    32,
    () => calls >= 1,
    2,
  );
  expect(cancelledOutcome).toEqual({ ok: false, reason: "cancelled" });
});

test("filterSessions and countSessionsByStatus support multi-term queries and status chips", () => {
  const sessions = [
    {
      sessionId: "alpha-dev",
      spaceId: "space-one",
      userId: "alice",
      status: "active" as const,
      createdAt: "2026-11-27T00:00:00Z",
    },
    {
      sessionId: "gamma-boot",
      spaceId: "space-one",
      userId: "alice",
      status: "starting" as const,
      createdAt: "2026-11-27T00:30:00Z",
    },
    {
      sessionId: "beta-prod",
      spaceId: "space-two",
      userId: "bob",
      status: "stopped" as const,
      createdAt: "2026-11-27T01:00:00Z",
    },
  ];

  expect(countSessionsByStatus(sessions)).toEqual({
    all: 3,
    active: 1,
    starting: 1,
    stopped: 1,
  });

  expect(filterSessions(sessions, "")).toHaveLength(3);
  expect(filterSessions(sessions, "  ALPHA ")).toEqual([sessions[0]]);
  expect(filterSessions(sessions, "space-two")).toEqual([sessions[2]]);
  expect(filterSessions(sessions, "bob stopped")).toEqual([sessions[2]]);
  expect(filterSessions(sessions, "alice stopped")).toEqual([]);
  expect(filterSessions(sessions, "", "active")).toEqual([sessions[0]]);
  expect(filterSessions(sessions, "", "starting")).toEqual([sessions[1]]);
  expect(filterSessions(sessions, "", "stopped")).toEqual([sessions[2]]);
  expect(filterSessions(sessions, "alice", "starting")).toEqual([sessions[1]]);
  expect(filterSessions(sessions, "alice", "stopped")).toEqual([]);
});

test("attachDialogTrap handles stacking, IME-safe Escape, Shift+Tab from panel, inert ref-counting, and #main fallback", async () => {
  type Listener = (event: KeyboardEvent) => void;
  const listeners: Listener[] = [];
  let activeEl: FakeElement | null = null;
  const origHTMLElement = globalThis.HTMLElement;

  class FakeElement {
    isConnected = true;
    inert = false;
    style: { overflow: string } = { overflow: "" };
    children: FakeElement[] = [];
    attributes = new Map<string, string>();
    ownerDocument: FakeDocument;

    constructor(ownerDocument: FakeDocument, public readonly id = "") {
      this.ownerDocument = ownerDocument;
    }

    focus() {
      if (this.inert) return;
      activeEl = this;
    }

    hasAttribute(name: string) {
      return this.attributes.has(name);
    }

    closest(selector: string) {
      if (selector.includes("[inert]") && this.inert) return this;
      return null;
    }

    contains(node: unknown): boolean {
      if (node === this) return true;
      return this.children.some((c) => c.contains(node));
    }

    querySelector(selector: string): FakeElement | null {
      if (selector === "[autofocus]") {
        return this.children.find((c) => c.attributes.has("autofocus")) ?? null;
      }
      return null;
    }

    querySelectorAll(): FakeElement[] {
      return this.children.filter((c) => !c.attributes.has("disabled"));
    }

    getClientRects() {
      return [{ width: 10, height: 10 }];
    }
  }

  class FakeDocument {
    body: FakeElement;
    app: FakeElement;
    main: FakeElement;
    defaultView = {
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
    };

    constructor() {
      this.body = new FakeElement(this, "body");
      this.app = new FakeElement(this, "app");
      this.main = new FakeElement(this, "main");
      this.app.children.push(this.main);
    }

    get activeElement() {
      return activeEl;
    }

    getElementById(id: string) {
      if (id === "app") return this.app;
      if (id === "main") return this.main;
      return null;
    }

    addEventListener(type: string, fn: Listener) {
      if (type === "keydown") listeners.push(fn);
    }

    removeEventListener(type: string, fn: Listener) {
      if (type !== "keydown") return;
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    }

    dispatchKey(init: Partial<KeyboardEvent> & { key: string }) {
      const event = {
        key: init.key,
        shiftKey: Boolean(init.shiftKey),
        isComposing: Boolean(init.isComposing),
        keyCode: init.keyCode ?? 0,
        preventDefault() {},
        stopPropagation() {},
      } as KeyboardEvent;
      for (const fn of [...listeners]) fn(event);
    }
  }

  (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeElement;
  try {
    const doc = new FakeDocument();
    const opener = new FakeElement(doc, "opener");
    doc.app.children.push(opener);
    activeEl = opener;

    const dialog1 = new FakeElement(doc, "dialog-1");
    const d1First = new FakeElement(doc, "d1-first");
    const d1Last = new FakeElement(doc, "d1-last");
    dialog1.children.push(d1First, d1Last);

    let esc1 = 0;
    const detach1 = attachDialogTrap({
      container: dialog1 as unknown as HTMLElement,
      onEscape: () => esc1++,
    });
    await Promise.resolve();

    expect(getOpenDialogCount()).toBe(1);
    expect(doc.app.inert).toBe(true);
    expect(doc.body.style.overflow).toBe("hidden");
    expect(activeEl).toBe(d1First);

    // Shift+Tab from container wraps to last focusable element
    activeEl = dialog1;
    doc.dispatchKey({ key: "Tab", shiftKey: true });
    expect(activeEl).toBe(d1Last);

    // Tab from last wraps to first
    doc.dispatchKey({ key: "Tab", shiftKey: false });
    expect(activeEl).toBe(d1First);

    // IME composing Escape must be ignored
    doc.dispatchKey({ key: "Escape", isComposing: true, keyCode: 229 });
    expect(esc1).toBe(0);

    // Stack dialog2 on top: dialog1 becomes inert and does NOT receive Escape
    const dialog2 = new FakeElement(doc, "dialog-2");
    const d2Btn = new FakeElement(doc, "d2-btn");
    dialog2.children.push(d2Btn);
    let esc2 = 0;
    const detach2 = attachDialogTrap({
      container: dialog2 as unknown as HTMLElement,
      onEscape: () => esc2++,
    });
    await Promise.resolve();

    expect(getOpenDialogCount()).toBe(2);
    expect(dialog1.inert).toBe(true);
    expect(activeEl).toBe(d2Btn);

    doc.dispatchKey({ key: "Escape" });
    expect(esc2).toBe(1);
    expect(esc1).toBe(0);

    // Close dialog2: dialog1 inert restored, #app stays inert while dialog1 open
    detach2();
    expect(getOpenDialogCount()).toBe(1);
    expect(dialog1.inert).toBe(false);
    expect(doc.app.inert).toBe(true);
    expect(activeEl).toBe(d1First);

    // Disconnect opener before closing dialog1 -> must fall back to #main
    opener.isConnected = false;
    detach1();
    expect(getOpenDialogCount()).toBe(0);
    expect(doc.app.inert).toBe(false);
    expect(doc.body.style.overflow).toBe("");
    expect(activeEl).toBe(doc.main);
  } finally {
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement =
      origHTMLElement;
  }
});

test("validateCreateSessionInput trims inputs and rejects whitespace, reserved prefixes, control chars, and byte overflow", () => {
  expect(
    validateCreateSessionInput({
      sessionId: "  dev-01  ",
      spaceId: " space-a ",
      userId: " alice ",
    }),
  ).toEqual({
    ok: true,
    value: { sessionId: "dev-01", spaceId: "space-a", userId: "alice" },
  });

  expect(
    validateCreateSessionInput({
      sessionId: "   ",
      spaceId: "space-a",
      userId: "alice",
    }),
  ).toEqual({ ok: false, errorKey: "validationRequired" });

  expect(
    validateCreateSessionInput({
      sessionId: "pmcp-forbidden",
      spaceId: "space-a",
      userId: "alice",
    }),
  ).toEqual({
    ok: false,
    errorKey: "validationSessionIdReserved",
    params: { prefix: "pmcp-" },
  });

  expect(
    validateCreateSessionInput({
      sessionId: "bad\nid",
      spaceId: "space-a",
      userId: "alice",
    }),
  ).toEqual({ ok: false, errorKey: "validationSessionIdInvalid" });

  expect(
    validateCreateSessionInput({
      sessionId: "あ".repeat(41), // 123 UTF-8 bytes > 120
      spaceId: "space-a",
      userId: "alice",
    }),
  ).toEqual({
    ok: false,
    errorKey: "validationSessionIdTooLong",
    params: { max: MAX_SESSION_ID_BYTES },
  });
});

test("validateNewFileName accepts nested relative paths and rejects traversal or invalid paths", () => {
  expect(validateNewFileName("  README.md ")).toEqual({
    ok: true,
    value: { relativePath: "README.md", basename: "README.md" },
  });
  expect(validateNewFileName("src/components/App.tsx")).toEqual({
    ok: true,
    value: { relativePath: "src/components/App.tsx", basename: "App.tsx" },
  });

  expect(validateNewFileName("   ")).toEqual({
    ok: false,
    errorKey: "validationFileNameRequired",
  });
  for (
    const invalid of [
      "/etc/passwd",
      "dir/",
      "../escape.txt",
      "a/../b.txt",
      "./notes.txt",
      "a//b.txt",
      "a\\b.txt",
      "bad\u0000name",
    ]
  ) {
    expect(validateNewFileName(invalid), invalid).toEqual({
      ok: false,
      errorKey: "validationFileNameInvalid",
    });
  }
});

test("checkNewFileTargetInfo allows only confirmed non-existent targets and fails closed otherwise", () => {
  expect(checkNewFileTargetInfo({ exists: false, type: "unknown" })).toEqual({
    ok: true,
  });
  expect(checkNewFileTargetInfo({ exists: true, type: "file" })).toEqual({
    ok: false,
    errorKey: "fileAlreadyExists",
  });
  expect(checkNewFileTargetInfo({ exists: true, type: "symlink" })).toEqual({
    ok: false,
    errorKey: "fileAlreadyExists",
  });
  expect(checkNewFileTargetInfo({ exists: true, type: "directory" })).toEqual({
    ok: false,
    errorKey: "directoryAlreadyExists",
  });
  expect(checkNewFileTargetInfo(null)).toEqual({
    ok: false,
    errorKey: "fileExistsCheckFailed",
  });
  expect(checkNewFileTargetInfo({})).toEqual({
    ok: false,
    errorKey: "fileExistsCheckFailed",
  });
});

test("shell history helpers deduplicate consecutive commands and preserve unsubmitted drafts", () => {
  let history = pushShellHistory([], "ls");
  history = pushShellHistory(history, "ls");
  history = pushShellHistory(history, "pwd");
  expect(history).toEqual(["pwd", "ls"]);

  // Step up from unsubmitted draft -> preserves draft
  const up1 = stepShellHistory(
    { entries: history, index: -1, draft: "" },
    "up",
    "git sta",
  );
  expect(up1).toEqual({
    nextIndex: 0,
    nextDraft: "git sta",
    nextInput: "pwd",
    changed: true,
  });

  // Step up further -> keeps saved draft
  const up2 = stepShellHistory(
    { entries: history, index: up1.nextIndex, draft: up1.nextDraft },
    "up",
    up1.nextInput,
  );
  expect(up2).toEqual({
    nextIndex: 1,
    nextDraft: "git sta",
    nextInput: "ls",
    changed: true,
  });

  // Step down back to index 0 -> pwd
  const down1 = stepShellHistory(
    { entries: history, index: up2.nextIndex, draft: up2.nextDraft },
    "down",
    up2.nextInput,
  );
  expect(down1).toEqual({
    nextIndex: 0,
    nextDraft: "git sta",
    nextInput: "pwd",
    changed: true,
  });

  // Step down past 0 -> restores original unsubmitted draft
  const down2 = stepShellHistory(
    { entries: history, index: down1.nextIndex, draft: down1.nextDraft },
    "down",
    down1.nextInput,
  );
  expect(down2).toEqual({
    nextIndex: -1,
    nextDraft: "",
    nextInput: "git sta",
    changed: true,
  });
});

test("time formatting and ApiError preserve HTTP status and localized relative/absolute labels", () => {
  const err = new ApiError(404, "Session not found");
  expect(err).toBeInstanceOf(Error);
  expect(err.status).toBe(404);
  expect(err.message).toBe("Session not found");

  setLanguage("en");
  const now = Date.parse("2026-11-28T12:00:00Z");
  expect(formatRelativeTime("2026-11-28T11:59:30Z", t, now)).toBe("just now");
  expect(formatRelativeTime("2026-11-28T11:45:00Z", t, now)).toBe("15m ago");
  expect(formatRelativeTime("2026-11-28T09:00:00Z", t, now)).toBe("3h ago");
  expect(formatRelativeTime("2026-11-26T12:00:00Z", t, now)).toBe("2d ago");
  expect(formatRelativeTime("not-a-date", t, now)).toBe("");
  expect(formatAbsoluteTime("2026-11-28T12:00:00Z", "en").length)
    .toBeGreaterThan(0);
  expect(formatAbsoluteTime("2026-11-28T12:00:00Z", "ja").length)
    .toBeGreaterThan(0);
  expect(formatClockTime(new Date(now), "en").length).toBeGreaterThan(0);
});

test("shell output search highlights case-insensitively, skips initial hint, handles regex chars, caps matches, and steps cyclically", () => {
  const lines = [
    { text: "Type a command and press Enter.\n", kind: "hint" as const, initialHint: true },
    { text: "$ grep [error] log\n", kind: "cmd" as const },
    { text: "Line 1: [ERROR] alpha [error]\n", kind: "out" as const },
    { text: "Line 2: ok\n", kind: "out" as const },
  ];

  // Empty query returns plain segments with 0 matches
  const empty = highlightShellLines(lines, "");
  expect(empty.totalMatches).toBe(0);
  expect(empty.capped).toBe(false);
  expect(empty.lines).toHaveLength(4);

  // Initial hint is never highlighted even when query matches its text
  const hintOnly = highlightShellLines(lines, "press Enter");
  expect(hintOnly.totalMatches).toBe(0);

  // Regex metacharacters are matched literally and case-insensitively
  const res = highlightShellLines(lines, "[error]");
  expect(res.totalMatches).toBe(3);
  expect(res.capped).toBe(false);
  expect(res.lines[1]?.segments).toEqual([
    { text: "$ grep ", matchIndex: null },
    { text: "[error]", matchIndex: 0 },
    { text: " log\n", matchIndex: null },
  ]);
  expect(res.lines[2]?.segments).toEqual([
    { text: "Line 1: ", matchIndex: null },
    { text: "[ERROR]", matchIndex: 1 },
    { text: " alpha ", matchIndex: null },
    { text: "[error]", matchIndex: 2 },
    { text: "\n", matchIndex: null },
  ]);

  // Cap prevents DOM explosion on huge outputs
  const capped = highlightShellLines(lines, "[error]", 2);
  expect(capped.totalMatches).toBe(2);
  expect(capped.capped).toBe(true);

  // Cyclic navigation
  expect(stepShellSearchMatch(0, 3, 1)).toBe(1);
  expect(stepShellSearchMatch(2, 3, 1)).toBe(0);
  expect(stepShellSearchMatch(0, 3, -1)).toBe(2);
  expect(stepShellSearchMatch(-1, 3, 1)).toBe(0);
  expect(stepShellSearchMatch(-1, 3, -1)).toBe(2);
  expect(stepShellSearchMatch(0, 0, 1)).toBe(-1);
});

test("viewer status helpers deduplicate unchanged poll announcements and prevent background loading flicker", () => {
  const activeState = {
    sessionId: "s1",
    spaceId: "sp",
    userId: "u",
    status: "active" as const,
    createdAt: "2026-11-28T00:00:00Z",
  };
  const stoppedState = { ...activeState, status: "stopped" as const };

  expect(resolveViewerStatusKey({ kind: "ok", state: activeState })).toBe("active");
  expect(resolveViewerStatusKey({ kind: "ok", state: stoppedState })).toBe("stopped");
  expect(resolveViewerStatusKey({ kind: "not_found" })).toBe("notFound");
  expect(resolveViewerStatusKey({ kind: "unavailable" })).toBe("statusUnavailable");

  // Initial settled status announces once; identical polls do not re-announce
  expect(shouldAnnounceViewerStatus(null, "s1", "active")).toBe(true);
  expect(
    shouldAnnounceViewerStatus({ sessionId: "s1", key: "active" }, "s1", "active"),
  ).toBe(false);
  // Status transition or session switch announces
  expect(
    shouldAnnounceViewerStatus({ sessionId: "s1", key: "active" }, "s1", "stopped"),
  ).toBe(true);
  expect(
    shouldAnnounceViewerStatus({ sessionId: "s1", key: "active" }, "s2", "active"),
  ).toBe(true);

  // Background poll while already ok suppresses loading badge flicker
  expect(
    shouldShowViewerStatusLoading({
      loading: true,
      manualRefresh: false,
      sessionId: "s1",
      lastSettled: { sessionId: "s1", result: { kind: "ok", state: activeState } },
    }),
  ).toBe(false);

  // Manual refresh, initial load, error recovery, and session switch still show loading
  expect(
    shouldShowViewerStatusLoading({
      loading: true,
      manualRefresh: true,
      sessionId: "s1",
      lastSettled: { sessionId: "s1", result: { kind: "ok", state: activeState } },
    }),
  ).toBe(true);
  expect(
    shouldShowViewerStatusLoading({
      loading: true,
      manualRefresh: false,
      sessionId: "s1",
      lastSettled: null,
    }),
  ).toBe(true);
  expect(
    shouldShowViewerStatusLoading({
      loading: true,
      manualRefresh: false,
      sessionId: "s1",
      lastSettled: { sessionId: "s1", result: { kind: "unavailable" } },
    }),
  ).toBe(true);
  expect(
    shouldShowViewerStatusLoading({
      loading: true,
      manualRefresh: false,
      sessionId: "s2",
      lastSettled: { sessionId: "s1", result: { kind: "ok", state: activeState } },
    }),
  ).toBe(true);
});

test("attachDialogTrap uses getRestoreFocusFallback before #main when opener disconnects", async () => {
  type Listener = (event: KeyboardEvent) => void;
  const listeners: Listener[] = [];
  let activeEl: FakeEl | null = null;
  const origHTMLElement = globalThis.HTMLElement;

  class FakeEl {
    isConnected = true;
    inert = false;
    style: { overflow: string } = { overflow: "" };
    children: FakeEl[] = [];
    ownerDocument: FakeDoc;
    constructor(ownerDocument: FakeDoc, public readonly id = "") {
      this.ownerDocument = ownerDocument;
    }
    focus() {
      if (!this.inert) activeEl = this;
    }
    hasAttribute() {
      return false;
    }
    closest(selector: string) {
      return selector.includes("[inert]") && this.inert ? this : null;
    }
    contains(node: unknown): boolean {
      return node === this || this.children.some((c) => c.contains(node));
    }
    querySelector() {
      return null;
    }
    querySelectorAll() {
      return this.children;
    }
    getClientRects() {
      return [{ width: 10, height: 10 }];
    }
  }

  class FakeDoc {
    body = new FakeEl(this, "body");
    app = new FakeEl(this, "app");
    main = new FakeEl(this, "main");
    defaultView = {
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
    };
    constructor() {
      this.app.children.push(this.main);
    }
    get activeElement() {
      return activeEl;
    }
    getElementById(id: string) {
      if (id === "app") return this.app;
      if (id === "main") return this.main;
      return null;
    }
    addEventListener(type: string, fn: Listener) {
      if (type === "keydown") listeners.push(fn);
    }
    removeEventListener(type: string, fn: Listener) {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    }
  }

  (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeEl;
  try {
    const doc = new FakeDoc();
    const opener = new FakeEl(doc, "row-stop-btn");
    const fallbackBtn = new FakeEl(doc, "section-refresh-btn");
    doc.app.children.push(opener, fallbackBtn);
    activeEl = opener;

    const dlg = new FakeEl(doc, "confirm-dialog");
    const btn = new FakeEl(doc, "confirm-btn");
    dlg.children.push(btn);

    const detach = attachDialogTrap({
      container: dlg as unknown as HTMLElement,
      onEscape: () => {},
      getRestoreFocusFallback: () => fallbackBtn as unknown as HTMLElement,
    });
    await Promise.resolve();
    expect(activeEl).toBe(btn);

    opener.isConnected = false;
    detach();
    expect(activeEl).toBe(fallbackBtn);
  } finally {
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement =
      origHTMLElement;
  }
});
