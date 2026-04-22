import { assertEquals } from "@std/assert";
import { isLocalhost, isPrivateIP } from "../validation.ts";

// ---------- isLocalhost ----------

Deno.test("isLocalhost: 'localhost' returns true", () => {
  assertEquals(isLocalhost("localhost"), true);
});

Deno.test("isLocalhost: '127.0.0.1' returns true", () => {
  assertEquals(isLocalhost("127.0.0.1"), true);
});

Deno.test("isLocalhost: '::1' returns true", () => {
  assertEquals(isLocalhost("::1"), true);
});

Deno.test("isLocalhost: 'foo.localhost' returns true", () => {
  assertEquals(isLocalhost("foo.localhost"), true);
});

Deno.test("isLocalhost: 'foo.local' returns true", () => {
  assertEquals(isLocalhost("foo.local"), true);
});

Deno.test("isLocalhost: 'app.localdomain' returns true", () => {
  assertEquals(isLocalhost("app.localdomain"), true);
});

Deno.test("isLocalhost: 'svc.internal' returns true", () => {
  assertEquals(isLocalhost("svc.internal"), true);
});

Deno.test("isLocalhost: 'google.com' returns false", () => {
  assertEquals(isLocalhost("google.com"), false);
});

Deno.test("isLocalhost: '192.168.1.1' returns false", () => {
  assertEquals(isLocalhost("192.168.1.1"), false);
});

Deno.test("isLocalhost: case-insensitive", () => {
  assertEquals(isLocalhost("LOCALHOST"), true);
  assertEquals(isLocalhost("Foo.LocalHost"), true);
});

// ---------- isPrivateIP ----------

Deno.test("isPrivateIP: '10.0.0.1' returns true (10.0.0.0/8)", () => {
  assertEquals(isPrivateIP("10.0.0.1"), true);
});

Deno.test("isPrivateIP: '172.16.0.1' returns true (172.16.0.0/12)", () => {
  assertEquals(isPrivateIP("172.16.0.1"), true);
});

Deno.test("isPrivateIP: '172.31.255.255' returns true", () => {
  assertEquals(isPrivateIP("172.31.255.255"), true);
});

Deno.test("isPrivateIP: '172.15.0.1' returns false (outside 172.16-31)", () => {
  assertEquals(isPrivateIP("172.15.0.1"), false);
});

Deno.test("isPrivateIP: '172.32.0.1' returns false (outside 172.16-31)", () => {
  assertEquals(isPrivateIP("172.32.0.1"), false);
});

Deno.test("isPrivateIP: '192.168.1.1' returns true (192.168.0.0/16)", () => {
  assertEquals(isPrivateIP("192.168.1.1"), true);
});

Deno.test("isPrivateIP: '127.0.0.1' returns true (loopback)", () => {
  assertEquals(isPrivateIP("127.0.0.1"), true);
});

Deno.test("isPrivateIP: '8.8.8.8' returns false (public)", () => {
  assertEquals(isPrivateIP("8.8.8.8"), false);
});

Deno.test("isPrivateIP: '1.1.1.1' returns false (public)", () => {
  assertEquals(isPrivateIP("1.1.1.1"), false);
});

Deno.test("isPrivateIP: '169.254.1.1' returns true (link-local)", () => {
  assertEquals(isPrivateIP("169.254.1.1"), true);
});

Deno.test("isPrivateIP: '0.0.0.0' returns true (current network)", () => {
  assertEquals(isPrivateIP("0.0.0.0"), true);
});

Deno.test("isPrivateIP: '100.64.0.1' returns true (carrier-grade NAT)", () => {
  assertEquals(isPrivateIP("100.64.0.1"), true);
});

Deno.test("isPrivateIP: '224.0.0.1' returns true (multicast)", () => {
  assertEquals(isPrivateIP("224.0.0.1"), true);
});

// IPv6 private ranges

Deno.test("isPrivateIP: '::1' returns true (IPv6 loopback)", () => {
  assertEquals(isPrivateIP("::1"), true);
});

Deno.test("isPrivateIP: 'fe80::1' returns true (IPv6 link-local)", () => {
  assertEquals(isPrivateIP("fe80::1"), true);
});

Deno.test("isPrivateIP: 'fd00::1' returns true (IPv6 unique local)", () => {
  assertEquals(isPrivateIP("fd00::1"), true);
});

Deno.test("isPrivateIP: 'fc00::1' returns true (IPv6 unique local)", () => {
  assertEquals(isPrivateIP("fc00::1"), true);
});

// IPv4-mapped IPv6

Deno.test("isPrivateIP: '::ffff:192.168.1.1' returns true (IPv4-mapped)", () => {
  assertEquals(isPrivateIP("::ffff:192.168.1.1"), true);
});

Deno.test("isPrivateIP: '::ffff:8.8.8.8' returns false (IPv4-mapped public)", () => {
  assertEquals(isPrivateIP("::ffff:8.8.8.8"), false);
});

Deno.test("isPrivateIP: '::ffff:c0a8:0101' returns true (hex form)", () => {
  // c0a8:0101 = 192.168.1.1
  assertEquals(isPrivateIP("::ffff:c0a8:0101"), true);
});
