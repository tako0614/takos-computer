import { expect, test } from "bun:test";

import { generateProxyToken } from "../proxy-token.ts";

test("generateProxyToken: returns a string", () => {
  const token = generateProxyToken();
  expect(typeof token).toEqual("string");
});

test("generateProxyToken: length is consistent (base64url of 32 bytes)", () => {
  // 32 bytes -> 44 base64 chars -> minus padding (0-2 '=' chars)
  // base64url removes '=', so length should be 43 (ceil(32*4/3) = 43)
  const token = generateProxyToken();
  expect(token.length).toEqual(43);
});

test("generateProxyToken: two calls produce different tokens", () => {
  const token1 = generateProxyToken();
  const token2 = generateProxyToken();
  expect(token1).not.toEqual(token2);
});

test("generateProxyToken: token contains only valid base64url characters", () => {
  const token = generateProxyToken();
  // base64url: [A-Za-z0-9_-], no +, /, or = padding
  expect(/^[A-Za-z0-9_-]+$/.test(token)).toBeTruthy();
});

test("generateProxyToken: multiple tokens are all unique", () => {
  const tokens = new Set<string>();
  for (let i = 0; i < 100; i++) {
    tokens.add(generateProxyToken());
  }
  expect(tokens.size).toEqual(100);
});
