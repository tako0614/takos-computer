import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { computerIconSvg } from "../gui/icon.ts";

// The tcs.json iconUrl advertises packages/dashboard/public/icons/computer.svg
// while the worker serves the in-source computerIconSvg at /icons/computer.svg.
// Keep the two byte-equal so discovery and launcher never show different art.
test("served computer icon matches the tcs.json-declared source file", () => {
  const declared = readFileSync(
    new URL("../../../dashboard/public/icons/computer.svg", import.meta.url),
    "utf8",
  );
  expect(`${computerIconSvg.trim()}\n`).toBe(declared);
});
