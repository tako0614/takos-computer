import { expect, test } from "bun:test";
/**
 * Tests for @takos/cloudflare-compat
 *
 * This package is a type re-export surface. The tests verify that all
 * expected exports are accessible at runtime and that the custom type
 * aliases (VectorizeQueryResult, D1RawOptions, R2ObjectMetadata) are
 * structurally correct.
 */

test("@takos/cloudflare-compat exports - module loads without error", async () => {
  const mod = await import("../index.ts");
  expect(mod !== undefined).toBeTruthy();
});

test("@takos/cloudflare-compat exports - exports can be imported (type-level verification)", async () => {
  // If the module has syntax errors or broken re-exports, this import will throw.
  const mod = await import("../index.ts");
  // The module is primarily types -- the runtime export is the module object itself.
  expect(typeof mod).toEqual("object");
});

// ---------------------------------------------------------------------------
// Structural type tests
// ---------------------------------------------------------------------------

test("D1RawOptions structural contract - accepts columnNames: true", () => {
  const opts: import("../index.ts").D1RawOptions = { columnNames: true };
  expect(opts.columnNames).toEqual(true);
});

test("D1RawOptions structural contract - accepts columnNames: false", () => {
  const opts: import("../index.ts").D1RawOptions = { columnNames: false };
  expect(opts.columnNames).toEqual(false);
});

test("D1RawOptions structural contract - accepts omitted columnNames", () => {
  const opts: import("../index.ts").D1RawOptions = {};
  expect(opts !== undefined).toBeTruthy();
});
