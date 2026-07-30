import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const dockerfile = await readFile(
  new URL("../apps/sandbox/Dockerfile", import.meta.url),
  "utf8",
);

test("sandbox stages use one immutable Bun image", () => {
  const fromImages = Array.from(
    dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+\S+)?$/gim),
    (match) => match[1],
  );

  expect(fromImages).toHaveLength(2);
  expect(new Set(fromImages).size).toBe(1);
  expect(fromImages[0]).toMatch(
    /^docker\.io\/oven\/bun@sha256:[a-f0-9]{64}$/u,
  );
});
