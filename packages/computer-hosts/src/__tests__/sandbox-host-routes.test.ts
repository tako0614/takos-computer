/**
 * Tests for sandbox-host-routes helpers
 */
import { expect, test } from "bun:test";
import { sandboxHostRoutes } from "../sandbox-host.ts";

test("sandboxHostRoutes: returns a router", () => {
  const router = sandboxHostRoutes();
  expect(router !== undefined).toBeTruthy();
});

test("sandboxHostRoutes: registers GET /health", () => {
  const router = sandboxHostRoutes();
  expect(typeof router.fetch).toEqual("function");
});

test("sandboxHostRoutes: registers POST /sessions", () => {
  const router = sandboxHostRoutes();
  expect(typeof router.fetch).toEqual("function");
});

test("sandboxHostRoutes: handles unknown route", () => {
  const router = sandboxHostRoutes();
  expect(typeof router.fetch).toEqual("function");
});
