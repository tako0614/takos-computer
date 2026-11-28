import type { SessionState } from "./api.ts";

export type SessionStatusFilter = "all" | "active" | "starting" | "stopped";

export interface SessionStatusCounts {
  all: number;
  active: number;
  starting: number;
  stopped: number;
}

function normalizeStatus(status: string): "active" | "starting" | "stopped" {
  return status === "active" || status === "starting" ? status : "stopped";
}

export function countSessionsByStatus(
  sessions: readonly SessionState[],
): SessionStatusCounts {
  const counts: SessionStatusCounts = {
    all: sessions.length,
    active: 0,
    starting: 0,
    stopped: 0,
  };
  for (const session of sessions) {
    counts[normalizeStatus(session.status)]++;
  }
  return counts;
}

export function filterSessions(
  sessions: readonly SessionState[],
  rawQuery: string,
  statusFilter: SessionStatusFilter = "all",
): SessionState[] {
  const normalized = rawQuery.trim().toLowerCase();
  const terms = normalized ? normalized.split(/\s+/).filter(Boolean) : [];

  return sessions.filter((session) => {
    if (
      statusFilter !== "all" && normalizeStatus(session.status) !== statusFilter
    ) {
      return false;
    }
    if (terms.length === 0) return true;
    const haystack = [
      session.sessionId,
      session.spaceId,
      session.userId,
      session.status,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
