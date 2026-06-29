import { expect, test } from "bun:test";

import { constantTimeEqual } from "@takos-computer/common/crypto";

test("constantTimeEqual: equal strings return true", () => {
  expect(constantTimeEqual("hello", "hello")).toEqual(true);
});

test("constantTimeEqual: different strings return false", () => {
  expect(constantTimeEqual("hello", "world")).toEqual(false);
});

test("constantTimeEqual: different length strings return false", () => {
  expect(constantTimeEqual("short", "a longer string")).toEqual(false);
});

test("constantTimeEqual: empty strings return true", () => {
  expect(constantTimeEqual("", "")).toEqual(true);
});

test("constantTimeEqual: case sensitivity", () => {
  expect(constantTimeEqual("Hello", "hello")).toEqual(false);
  expect(constantTimeEqual("ABC", "abc")).toEqual(false);
});

test("constantTimeEqual: one empty one non-empty returns false", () => {
  expect(constantTimeEqual("", "a")).toEqual(false);
  expect(constantTimeEqual("a", "")).toEqual(false);
});

test("constantTimeEqual: same single character", () => {
  expect(constantTimeEqual("a", "a")).toEqual(true);
});

test("constantTimeEqual: hex token strings", () => {
  const a = "abcdef0123456789abcdef0123456789";
  const b = "abcdef0123456789abcdef0123456789";
  const c = "abcdef0123456789abcdef0123456780";
  expect(constantTimeEqual(a, b)).toEqual(true);
  expect(constantTimeEqual(a, c)).toEqual(false);
});
