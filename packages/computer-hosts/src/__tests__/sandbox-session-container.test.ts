/**
 * Tests for sandbox-session-container helpers
 */
import { expect, test } from "bun:test";
import { SandboxSessionContainer } from "../sandbox-session-container.ts";

test("SandboxSessionContainer: constructs with defaults", () => {
  const container = new SandboxSessionContainer();
  expect(container instanceof SandboxSessionContainer).toBeTruthy();
});

test("SandboxSessionContainer: tracks session id", () => {
  const container = new SandboxSessionContainer();
  expect(container.sessionId).toEqual(undefined);
});

test("SandboxSessionContainer: setSessionId updates id", () => {
  const container = new SandboxSessionContainer();
  container.setSessionId("sess-123");
  expect(container.sessionId).toEqual("sess-123");
});

test("SandboxSessionContainer: clearSessionId resets id", () => {
  const container = new SandboxSessionContainer();
  container.setSessionId("sess-123");
  container.clearSessionId();
  expect(container.sessionId).toEqual(undefined);
});

test("SandboxSessionContainer: isActive reflects state", () => {
  const container = new SandboxSessionContainer();
  expect(container.isActive).toEqual(false);
  container.setSessionId("sess-1");
  expect(container.isActive).toEqual(true);
});

test("SandboxSessionContainer: reset clears all state", () => {
  const container = new SandboxSessionContainer();
  container.setSessionId("sess-1");
  container.reset();
  expect(container.isActive).toEqual(false);
  expect(container.sessionId).toEqual(undefined);
});
