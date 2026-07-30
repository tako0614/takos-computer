import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const config = await readFile(
  new URL("../deploy/wrangler.sandbox-host.toml", import.meta.url),
  "utf8",
);

test("static Wrangler template uses the runtime entrypoint that exports every bound Durable Object", () => {
  expect(config).toContain(
    'main = "../packages/computer-hosts/src/sandbox-host-worker.ts"',
  );
  expect(config).toContain('class_name = "SandboxSessionContainer"');
  expect(config).toContain('class_name = "SessionQuotaCoordinator"');
  expect(config).toContain(
    'new_sqlite_classes = ["SessionQuotaCoordinator"]',
  );
});
