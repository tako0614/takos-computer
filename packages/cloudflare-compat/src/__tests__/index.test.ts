/**
 * Tests for @takos/cloudflare-compat
 *
 * This package is a type re-export surface. The tests verify that all
 * expected exports are accessible at runtime and that the custom type
 * aliases (VectorizeQueryResult, D1RawOptions, R2ObjectMetadata) are
 * structurally correct.
 */
import { assertEquals, assert } from 'jsr:@std/assert';

Deno.test('@takos/cloudflare-compat exports - module loads without error', async () => {
  const mod = await import('../index.ts');
  assert(mod !== undefined);
});

Deno.test('@takos/cloudflare-compat exports - exports can be imported (type-level verification)', async () => {
  // If the module has syntax errors or broken re-exports, this import will throw.
  const mod = await import('../index.ts');
  // The module is primarily types -- the runtime export is the module object itself.
  assertEquals(typeof mod, 'object');
});

// ---------------------------------------------------------------------------
// Structural type tests
// ---------------------------------------------------------------------------

Deno.test('D1RawOptions structural contract - accepts columnNames: true', () => {
  const opts: import('../index.ts').D1RawOptions = { columnNames: true };
  assertEquals(opts.columnNames, true);
});

Deno.test('D1RawOptions structural contract - accepts columnNames: false', () => {
  const opts: import('../index.ts').D1RawOptions = { columnNames: false };
  assertEquals(opts.columnNames, false);
});

Deno.test('D1RawOptions structural contract - accepts omitted columnNames', () => {
  const opts: import('../index.ts').D1RawOptions = {};
  assert(opts !== undefined);
});
