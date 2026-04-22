import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { generateId } from "../id.ts";

Deno.test("generateId: default length is 12 characters", () => {
  const id = generateId();
  assertEquals(id.length, 12);
});

Deno.test("generateId: custom length", () => {
  assertEquals(generateId(6).length, 6);
  assertEquals(generateId(24).length, 24);
  assertEquals(generateId(1).length, 1);
  assertEquals(generateId(100).length, 100);
});

Deno.test("generateId: only contains lowercase alphanumeric", () => {
  for (let i = 0; i < 50; i++) {
    const id = generateId(24);
    assert(
      /^[a-z0-9]+$/.test(id),
      `ID contains invalid characters: ${id}`,
    );
  }
});

Deno.test("generateId: two calls produce different IDs", () => {
  const id1 = generateId();
  const id2 = generateId();
  assertNotEquals(id1, id2);
});

Deno.test("generateId: generates unique IDs across many calls", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 200; i++) {
    ids.add(generateId());
  }
  assertEquals(ids.size, 200, "All 200 generated IDs should be unique");
});
