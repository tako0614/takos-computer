import { expect, test } from "bun:test";

import { generateId } from "../id.ts";

test("generateId: default length is 12 characters", () => {
  const id = generateId();
  expect(id.length).toEqual(12);
});

test("generateId: custom length", () => {
  expect(generateId(6).length).toEqual(6);
  expect(generateId(24).length).toEqual(24);
  expect(generateId(1).length).toEqual(1);
  expect(generateId(100).length).toEqual(100);
});

test("generateId: only contains lowercase alphanumeric", () => {
  for (let i = 0; i < 50; i++) {
    const id = generateId(24);
    expect(/^[a-z0-9]+$/.test(id)).toBeTruthy();
  }
});

test("generateId: two calls produce different IDs", () => {
  const id1 = generateId();
  const id2 = generateId();
  expect(id1).not.toEqual(id2);
});

test("generateId: generates unique IDs across many calls", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 200; i++) {
    ids.add(generateId());
  }
  expect(ids.size).toEqual(200);
});
