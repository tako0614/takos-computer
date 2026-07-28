/**
 * Sandbox session wire shapes shared across takos-computer packages.
 *
 * These describe the JSON exchanged between the sandbox host worker, the
 * published MCP surface, and the dashboard, so they live in `common` rather
 * than in any single host module.
 */

export interface CreateSandboxSessionPayload {
  sessionId: string;
  spaceId: string;
  userId: string;
}

export interface SandboxSessionState {
  sessionId: string;
  spaceId: string;
  userId: string;
  status: "starting" | "active" | "stopped";
  createdAt: string;
}

export const MAX_SANDBOX_SESSION_ID_BYTES = 120;

export function assertSandboxSessionId(sessionId: string): void {
  const bytes = new TextEncoder().encode(sessionId).byteLength;
  if (bytes === 0 || bytes > MAX_SANDBOX_SESSION_ID_BYTES) {
    throw new Error(
      `sessionId must be 1..${MAX_SANDBOX_SESSION_ID_BYTES} UTF-8 bytes`,
    );
  }
}
