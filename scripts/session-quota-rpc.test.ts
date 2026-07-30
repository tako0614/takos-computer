import { afterAll, beforeAll, expect, test } from "bun:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

let miniflare: Miniflare;

beforeAll(async () => {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL("./fixtures/session-quota-rpc-worker.ts", import.meta.url),
      ),
    ],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    external: ["cloudflare:workers"],
    write: false,
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error("Session quota RPC fixture did not build");

  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    durableObjects: {
      SANDBOX_QUOTA: {
        className: "SessionQuotaCoordinator",
        useSQLite: true,
      },
    },
    durableObjectsPersist: false,
    modules: true,
    script: output.text,
  });
  await miniflare.ready;
});

afterAll(async () => {
  await miniflare?.dispose();
});

test("SessionQuotaCoordinator is callable through a real workerd Durable Object RPC stub", async () => {
  const first = await miniflare.dispatchFetch(
    "http://quota.test/reserve?session=first&limit=1",
  );
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({
    ok: true,
    created: true,
    count: 1,
    limit: 1,
  });

  const denied = await miniflare.dispatchFetch(
    "http://quota.test/reserve?session=second&limit=1",
  );
  expect(denied.status).toBe(200);
  expect(await denied.json()).toMatchObject({
    ok: false,
    count: 1,
    limit: 1,
  });

  const release = await miniflare.dispatchFetch(
    "http://quota.test/release?session=first",
  );
  expect(release.status).toBe(200);
  expect(await release.json()).toEqual({ released: true });
});
