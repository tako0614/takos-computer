import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { setLanguage, t, type TranslationKey } from "../packages/dashboard/src/i18n.ts";

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
  for (const match of cssBlock.matchAll(/(--tc-[a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
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
    "run",
    "running",
    "retry",
    "directoryPath",
    "parentDirectory",
    "workspaceRoot",
    "sessionListUnavailable",
    "statusUnavailable",
    "unconfirmedDestroyCurrent",
    "noSessionsHint",
  ];

  for (const lang of ["en", "ja"] as const) {
    setLanguage(lang);
    for (const key of keys) {
      expect(t(key).trim().length).toBeGreaterThan(0);
    }
    expect(t("deleteSessionAria", { id: "s-01" })).toContain("s-01");
    expect(t("unconfirmedDestroySession", { id: "s-01" })).toContain("s-01");
  }
  setLanguage("en");
});

test("dashboard CSS tokens meet WCAG AA (>= 4.5:1) contrast in dark and light themes", () => {
  const css = readFileSync(new URL("src/styles.css", DASHBOARD_DIR), "utf8");
  const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
  expect(lightStart).toBeGreaterThan(0);

  const darkTokens = parseTokens(css.slice(0, lightStart));
  const lightTokens = {
    ...darkTokens,
    ...parseTokens(css.slice(lightStart, css.indexOf("\n}\n", lightStart + 100))),
  };

  for (const [mode, tokens] of [
    ["dark", darkTokens],
    ["light", lightTokens],
  ] as const) {
    const pairs: Array<[string, string, string]> = [
      ["fg on bg", tokens["--tc-fg"]!, tokens["--tc-bg"]!],
      ["fg on surface", tokens["--tc-fg"]!, tokens["--tc-surface"]!],
      ["fg-muted on bg", tokens["--tc-fg-muted"]!, tokens["--tc-bg"]!],
      ["fg-muted on surface", tokens["--tc-fg-muted"]!, tokens["--tc-surface"]!],
      ["accent-fg on accent", tokens["--tc-accent-fg"]!, tokens["--tc-accent"]!],
      ["danger-fg on danger", tokens["--tc-danger-fg"]!, tokens["--tc-danger"]!],
      ["dir-fg on surface", tokens["--tc-dir-fg"]!, tokens["--tc-surface"]!],
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
      ["term-fg on term-bg", tokens["--tc-term-fg"]!, tokens["--tc-term-bg"]!],
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

test("dashboard index.html includes favicon, color-scheme, and required theme-color", () => {
  const html = readFileSync(new URL("index.html", DASHBOARD_DIR), "utf8");
  expect(html).toContain('<meta name="theme-color" content="#0f172a">');
  expect(html).toContain('<meta name="color-scheme" content="dark light">');
  expect(html).toContain('<link rel="icon" type="image/png" href="/gui/icons/icon-192.png">');
});
