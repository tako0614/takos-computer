import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { webAppIcons, webAppManifest } from "../gui/assets.ts";
import worker from "../sandbox-host.ts";
import type { SandboxHostEnv } from "../sandbox-session-types.ts";

// Home-screen install contract. The dashboard's public/ files are the source;
// emit-assets.ts embeds them into assets.generated.ts for the Worker bundle.
const PUBLIC_DIR = new URL("../../../dashboard/public/", import.meta.url);
const GUI_BASE = "/gui/";

type WorkerFetch = (
  request: Request,
  env: SandboxHostEnv,
) => Promise<Response>;

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

function publicFile(path: string): Uint8Array {
  expect(path.startsWith(GUI_BASE)).toBe(true);
  return new Uint8Array(
    readFileSync(new URL(path.slice(GUI_BASE.length), PUBLIC_DIR)),
  );
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  // PNG signature, then the IHDR chunk: width/height are big-endian u32 at 16/20.
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe("IHDR");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function sourceManifest(): { icons: ManifestIcon[] } & Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL("manifest.webmanifest", PUBLIC_DIR), "utf8"),
  );
}

function indexHtml(): string {
  return readFileSync(new URL("../index.html", PUBLIC_DIR), "utf8");
}

// GUI auth on: anonymous /gui redirects to sign-in, which is exactly the state
// a browser is in when it fetches the manifest and icons.
function authRequiredEnv(): SandboxHostEnv {
  return {
    APP_AUTH_REQUIRED: "1",
    APP_SESSION_SECRET: "web-app-manifest-test-session-secret",
    OIDC_ISSUER_URL: "https://accounts.test",
    OIDC_CLIENT_ID: "takos-computer-test",
    SANDBOX_HOST_AUTH_TOKEN: "host-admin-token",
  } as unknown as SandboxHostEnv;
}

function fetchWorker(path: string): Promise<Response> {
  return (worker.fetch as WorkerFetch)(
    new Request(`https://sandbox-host.test${path}`),
    authRequiredEnv(),
  );
}

test("web app manifest declares the standalone /gui app", () => {
  expect(sourceManifest()).toMatchObject({
    id: "/gui",
    name: "Takos Computer",
    short_name: "Computer",
    lang: "en",
    start_url: "/gui",
    scope: "/gui",
    display: "standalone",
    theme_color: "#0f172a",
    background_color: "#0f172a",
  });
  expect(String(sourceManifest().description).length).toBeGreaterThan(0);
});

test("every declared icon exists at its declared pixel size", () => {
  const icons = sourceManifest().icons;
  expect(icons.map((icon) => `${icon.sizes}:${icon.purpose}`).sort()).toEqual([
    "192x192:any",
    "512x512:any",
    "512x512:maskable",
  ]);
  for (const icon of icons) {
    expect(icon.type).toBe("image/png");
    const [width, height] = icon.sizes.split("x").map(Number);
    expect(pngSize(publicFile(icon.src))).toEqual({ width, height });
  }
});

test("index.html links the manifest, a 180px apple-touch-icon and theme-color", () => {
  const html = indexHtml();
  expect(html).toContain(
    '<link rel="manifest" href="/gui/manifest.webmanifest">',
  );
  expect(html).toContain('<meta name="theme-color" content="#0f172a">');
  const touch = /<link rel="apple-touch-icon" sizes="180x180" href="([^"]+)">/u
    .exec(html);
  expect(touch).not.toBeNull();
  expect(pngSize(publicFile(touch![1]!))).toEqual({ width: 180, height: 180 });
});

test("the Worker bundle embeds the current manifest and icon bytes", () => {
  expect(webAppManifest).toBe(
    readFileSync(new URL("manifest.webmanifest", PUBLIC_DIR), "utf8"),
  );
  const expected = [
    ...sourceManifest().icons.map((icon) => icon.src),
    "/gui/icons/apple-touch-icon.png",
  ].sort();
  expect(Object.keys(webAppIcons).sort()).toEqual(expected);
  for (const [path, base64] of Object.entries(webAppIcons)) {
    expect(base64).toBe(Buffer.from(publicFile(path)).toString("base64"));
  }
});

test("manifest and icons are served anonymously while /gui stays gated", async () => {
  const gui = await fetchWorker("/gui");
  expect(gui.status).toBe(302);

  const manifest = await fetchWorker("/gui/manifest.webmanifest");
  expect(manifest.status).toBe(200);
  expect(manifest.headers.get("content-type")).toStartWith(
    "application/manifest+json",
  );
  expect(await manifest.json()).toEqual(sourceManifest());

  for (const path of Object.keys(webAppIcons)) {
    const icon = await fetchWorker(path);
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await icon.arrayBuffer())]).toEqual([
      ...publicFile(path),
    ]);
  }
});
