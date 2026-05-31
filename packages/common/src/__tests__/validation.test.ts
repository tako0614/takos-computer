import { expect, test } from "bun:test";

import { isLocalhost, isPrivateIP } from "../validation.ts";

// ---------- isLocalhost ----------

test("isLocalhost: 'localhost' returns true", () => {
  expect(isLocalhost("localhost")).toEqual(true);
});

test("isLocalhost: '127.0.0.1' returns true", () => {
  expect(isLocalhost("127.0.0.1")).toEqual(true);
});

test("isLocalhost: '::1' returns true", () => {
  expect(isLocalhost("::1")).toEqual(true);
});

test("isLocalhost: 'foo.localhost' returns true", () => {
  expect(isLocalhost("foo.localhost")).toEqual(true);
});

test("isLocalhost: 'foo.local' returns true", () => {
  expect(isLocalhost("foo.local")).toEqual(true);
});

test("isLocalhost: 'app.localdomain' returns true", () => {
  expect(isLocalhost("app.localdomain")).toEqual(true);
});

test("isLocalhost: 'svc.internal' returns true", () => {
  expect(isLocalhost("svc.internal")).toEqual(true);
});

test("isLocalhost: 'google.com' returns false", () => {
  expect(isLocalhost("google.com")).toEqual(false);
});

test("isLocalhost: '192.168.1.1' returns false", () => {
  expect(isLocalhost("192.168.1.1")).toEqual(false);
});

test("isLocalhost: case-insensitive", () => {
  expect(isLocalhost("LOCALHOST")).toEqual(true);
  expect(isLocalhost("Foo.LocalHost")).toEqual(true);
});

// ---------- isPrivateIP ----------

test("isPrivateIP: '10.0.0.1' returns true (10.0.0.0/8)", () => {
  expect(isPrivateIP("10.0.0.1")).toEqual(true);
});

test("isPrivateIP: '172.16.0.1' returns true (172.16.0.0/12)", () => {
  expect(isPrivateIP("172.16.0.1")).toEqual(true);
});

test("isPrivateIP: '172.31.255.255' returns true", () => {
  expect(isPrivateIP("172.31.255.255")).toEqual(true);
});

test("isPrivateIP: '172.15.0.1' returns false (outside 172.16-31)", () => {
  expect(isPrivateIP("172.15.0.1")).toEqual(false);
});

test("isPrivateIP: '172.32.0.1' returns false (outside 172.16-31)", () => {
  expect(isPrivateIP("172.32.0.1")).toEqual(false);
});

test("isPrivateIP: '192.168.1.1' returns true (192.168.0.0/16)", () => {
  expect(isPrivateIP("192.168.1.1")).toEqual(true);
});

test("isPrivateIP: '127.0.0.1' returns true (loopback)", () => {
  expect(isPrivateIP("127.0.0.1")).toEqual(true);
});

test("isPrivateIP: '8.8.8.8' returns false (public)", () => {
  expect(isPrivateIP("8.8.8.8")).toEqual(false);
});

test("isPrivateIP: '1.1.1.1' returns false (public)", () => {
  expect(isPrivateIP("1.1.1.1")).toEqual(false);
});

test("isPrivateIP: '169.254.1.1' returns true (link-local)", () => {
  expect(isPrivateIP("169.254.1.1")).toEqual(true);
});

test("isPrivateIP: '0.0.0.0' returns true (current network)", () => {
  expect(isPrivateIP("0.0.0.0")).toEqual(true);
});

test("isPrivateIP: '100.64.0.1' returns true (carrier-grade NAT)", () => {
  expect(isPrivateIP("100.64.0.1")).toEqual(true);
});

test("isPrivateIP: '224.0.0.1' returns true (multicast)", () => {
  expect(isPrivateIP("224.0.0.1")).toEqual(true);
});

// IPv6 private ranges

test("isPrivateIP: '::1' returns true (IPv6 loopback)", () => {
  expect(isPrivateIP("::1")).toEqual(true);
});

test("isPrivateIP: 'fe80::1' returns true (IPv6 link-local)", () => {
  expect(isPrivateIP("fe80::1")).toEqual(true);
});

test("isPrivateIP: 'fd00::1' returns true (IPv6 unique local)", () => {
  expect(isPrivateIP("fd00::1")).toEqual(true);
});

test("isPrivateIP: 'fc00::1' returns true (IPv6 unique local)", () => {
  expect(isPrivateIP("fc00::1")).toEqual(true);
});

// IPv4-mapped IPv6

test("isPrivateIP: '::ffff:192.168.1.1' returns true (IPv4-mapped)", () => {
  expect(isPrivateIP("::ffff:192.168.1.1")).toEqual(true);
});

test("isPrivateIP: '::ffff:8.8.8.8' returns false (IPv4-mapped public)", () => {
  expect(isPrivateIP("::ffff:8.8.8.8")).toEqual(false);
});

test("isPrivateIP: '::ffff:c0a8:0101' returns true (hex form)", () => {
  // c0a8:0101 = 192.168.1.1
  expect(isPrivateIP("::ffff:c0a8:0101")).toEqual(true);
});
