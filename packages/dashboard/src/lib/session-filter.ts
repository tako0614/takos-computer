import type { SessionState } from "./api.ts";

export function filterSessions(
  sessions: readonly SessionState[],
  rawQuery: string,
): SessionState[] {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [...sessions];

  const terms = normalized.split(/\s+/).filter(Boolean);
  return sessions.filter((session) => {
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
