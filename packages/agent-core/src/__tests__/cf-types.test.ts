/**
 * Tests for cf-types.ts
 *
 * This module defines structural interfaces for Cloudflare-shaped bindings
 * used in Node.js environments. These tests verify the type contracts are
 * sound by creating conforming objects and verifying their shapes.
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1ExecResult,
  R2Bucket,
  R2Object,
  R2ObjectMetadata,
  R2Objects,
  DurableObjectId,
  DurableObjectStub,
  DurableObjectNamespace,
  VectorizeIndex,
  VectorizeVector,
  VectorizeMatch,
  VectorizeQueryResult,
  Ai,
  Queue,
  Fetcher,
  KVNamespace,
} from '../cf-types.ts';

Deno.test('D1Database - accepts a conforming D1Database implementation', () => {
  const db: D1Database = {
    prepare: (query: string): D1PreparedStatement => ({
      bind: (..._values: unknown[]) => db.prepare(query),
      first: async () => null,
      run: async () => ({ results: [], success: true, meta: {} }),
      all: async () => ({ results: [], success: true, meta: {} }),
      raw: (async (): Promise<unknown[][]> => []) as D1PreparedStatement['raw'],
    }),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  };
  assert(db.prepare !== undefined);
  assert(db.batch !== undefined);
  assert(db.exec !== undefined);
});

Deno.test('D1Result - has the correct shape', () => {
  const result: D1Result = {
    results: [{ id: 1, name: 'test' }],
    success: true,
    meta: { duration: 1.5 },
  };
  assertEquals(result.results.length, 1);
  assertEquals(result.success, true);
});

Deno.test('D1ExecResult - has count and duration', () => {
  const result: D1ExecResult = { count: 5, duration: 10.2 };
  assertEquals(result.count, 5);
  assertEquals(result.duration, 10.2);
});

Deno.test('R2ObjectMetadata - accepts a conforming metadata object', () => {
  const meta: R2ObjectMetadata = {
    key: 'files/test.txt',
    size: 1024,
    etag: '"abc123"',
    httpEtag: '"abc123"',
    checksums: { md5: 'abc' },
    uploaded: new Date(),
  };
  assertEquals(meta.key, 'files/test.txt');
  assertEquals(meta.size, 1024);
});

Deno.test('R2Objects - has correct list response shape', () => {
  const result: R2Objects = {
    objects: [],
    truncated: false,
    delimitedPrefixes: [],
  };
  assertEquals(result.objects, []);
  assertEquals(result.truncated, false);
});

Deno.test('R2Objects - supports cursor for pagination', () => {
  const result: R2Objects = {
    objects: [],
    truncated: true,
    cursor: 'next-cursor',
    delimitedPrefixes: ['prefix/'],
  };
  assertEquals(result.cursor, 'next-cursor');
});

Deno.test('DurableObjectId - has toString and equals', () => {
  const id: DurableObjectId = {
    toString: () => 'do-id-123',
    equals: (other) => other.toString() === 'do-id-123',
  };
  assertEquals(id.toString(), 'do-id-123');
  assertEquals(id.equals(id), true);
});

Deno.test('DurableObjectId - supports optional name', () => {
  const id: DurableObjectId = {
    toString: () => 'do-named',
    equals: () => true,
    name: 'my-do',
  };
  assertEquals(id.name, 'my-do');
});

Deno.test('VectorizeVector - has required id and optional fields', () => {
  const vec: VectorizeVector = {
    id: 'vec-1',
    values: [0.1, 0.2, 0.3],
    metadata: { label: 'test' },
    namespace: 'default',
  };
  assertEquals(vec.id, 'vec-1');
  assertEquals(vec.values!.length, 3);
});

Deno.test('VectorizeVector - works with minimal fields', () => {
  const vec: VectorizeVector = { id: 'vec-2' };
  assertEquals(vec.id, 'vec-2');
  assertEquals(vec.values, undefined);
});

Deno.test('VectorizeMatch - has required id and score', () => {
  const match: VectorizeMatch = {
    id: 'match-1',
    score: 0.95,
  };
  assertEquals(match.id, 'match-1');
  assertEquals(match.score, 0.95);
});

Deno.test('VectorizeQueryResult - has matches and count', () => {
  const result: VectorizeQueryResult = {
    matches: [{ id: 'm-1', score: 0.9 }],
    count: 1,
  };
  assertEquals(result.matches.length, 1);
  assertEquals(result.count, 1);
});

Deno.test('QueueSendOptions - supports contentType and delaySeconds', () => {
  const opts: import('../cf-types.ts').QueueSendOptions = {
    contentType: 'json',
    delaySeconds: 30,
  };
  assertEquals(opts.contentType, 'json');
  assertEquals(opts.delaySeconds, 30);
});
