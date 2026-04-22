import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { generateProxyToken } from "../proxy-token.ts";

Deno.test("generateProxyToken: returns a string", () => {
  const token = generateProxyToken();
  assertEquals(typeof token, "string");
});

Deno.test("generateProxyToken: length is consistent (base64url of 32 bytes)", () => {
  // 32 bytes -> 44 base64 chars -> minus padding (0-2 '=' chars)
  // base64url removes '=', so length should be 43 (ceil(32*4/3) = 43)
  const token = generateProxyToken();
  assertEquals(token.length, 43);
});

Deno.test("generateProxyToken: two calls produce different tokens", () => {
  const token1 = generateProxyToken();
  const token2 = generateProxyToken();
  assertNotEquals(token1, token2);
});

Deno.test("generateProxyToken: token contains only valid base64url characters", () => {
  const token = generateProxyToken();
  // base64url: [A-Za-z0-9_-], no +, /, or = padding
  assert(
    /^[A-Za-z0-9_-]+$/.test(token),
    `Token contains invalid characters: ${token}`,
  );
});

Deno.test("generateProxyToken: multiple tokens are all unique", () => {
  const tokens = new Set<string>();
  for (let i = 0; i < 100; i++) {
    tokens.add(generateProxyToken());
  }
  assertEquals(tokens.size, 100, "All 100 generated tokens should be unique");
});
