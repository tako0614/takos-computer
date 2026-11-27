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
  buildBreadcrumbs,
  formatFileSize,
  isLikelyBinaryFile,
  joinWorkspacePath,
  parentWorkspaceDirectory,
} from "../packages/dashboard/src/lib/file-paths.ts";
import { filterSessions } from "../packages/dashboard/src/lib/session-filter.ts";
import {
  attachDialogTrap,
  getOpenDialogCount,
} from "../packages/dashboard/src/lib/dialog-a11y.ts";

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
    "unsavedChanges",
    "workspaceRoot",
  ];

  for (const lang of ["en", "ja"] as const) {
    setLanguage(lang);
    for (const key of keys) {
      expect(t(key).trim().length).toBeGreaterThan(0);
    }
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
    ];
    for (const [label, fg, bg] of pairs) {
      const ratio = contrastRatio(fg, bg);
      expect(ratio, `${mode} ${label} (${fg} on ${bg})`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  }
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
});

test("filterSessions matches across sessionId, spaceId, userId, and status with multi-term queries", () => {
  const sessions = [
    {
      sessionId: "alpha-dev",
      spaceId: "space-one",
      userId: "alice",
      status: "active" as const,
      createdAt: "2026-11-27T00:00:00Z",
    },
    {
      sessionId: "beta-prod",
      spaceId: "space-two",
      userId: "bob",
      status: "stopped" as const,
      createdAt: "2026-11-27T01:00:00Z",
    },
  ];

  expect(filterSessions(sessions, "")).toHaveLength(2);
  expect(filterSessions(sessions, "  ALPHA ")).toEqual([sessions[0]]);
  expect(filterSessions(sessions, "space-two")).toEqual([sessions[1]]);
  expect(filterSessions(sessions, "bob stopped")).toEqual([sessions[1]]);
  expect(filterSessions(sessions, "alice stopped")).toEqual([]);
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
