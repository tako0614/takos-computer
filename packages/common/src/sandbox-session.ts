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
