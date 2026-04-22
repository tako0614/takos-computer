import { assertEquals } from "@std/assert";
import { constantTimeEqual } from "../crypto-utils.ts";

Deno.test("constantTimeEqual: equal strings return true", () => {
  assertEquals(constantTimeEqual("hello", "hello"), true);
});

Deno.test("constantTimeEqual: different strings return false", () => {
  assertEquals(constantTimeEqual("hello", "world"), false);
});

Deno.test("constantTimeEqual: different length strings return false", () => {
  assertEquals(constantTimeEqual("short", "a longer string"), false);
});

Deno.test("constantTimeEqual: empty strings return true", () => {
  assertEquals(constantTimeEqual("", ""), true);
});

Deno.test("constantTimeEqual: case sensitivity", () => {
  assertEquals(constantTimeEqual("Hello", "hello"), false);
  assertEquals(constantTimeEqual("ABC", "abc"), false);
});

Deno.test("constantTimeEqual: one empty one non-empty returns false", () => {
  assertEquals(constantTimeEqual("", "a"), false);
  assertEquals(constantTimeEqual("a", ""), false);
});

Deno.test("constantTimeEqual: same single character", () => {
  assertEquals(constantTimeEqual("a", "a"), true);
});

Deno.test("constantTimeEqual: hex token strings", () => {
  const a = "abcdef0123456789abcdef0123456789";
  const b = "abcdef0123456789abcdef0123456789";
  const c = "abcdef0123456789abcdef0123456780";
  assertEquals(constantTimeEqual(a, b), true);
  assertEquals(constantTimeEqual(a, c), false);
});
