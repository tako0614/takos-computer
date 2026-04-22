export interface SessionState {
  sessionId: string;
  spaceId: string;
  userId: string;
  status: "starting" | "active" | "stopped";
  createdAt: string;
}

export interface CreateSessionPayload {
  sessionId: string;
  spaceId: string;
  userId: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Sandbox sessions
export const sandboxSessions = {
  list: () =>
    fetch("/gui/api/sandbox-sessions").then((r) =>
      json<{ sessions: SessionState[] }>(r)
    ),
  get: (id: string) =>
    fetch(`/gui/api/sandbox-session/${enc(id)}`).then((r) =>
      json<SessionState>(r)
    ),
  create: (p: CreateSessionPayload) =>
    fetch("/gui/api/sandbox-create", {
      method: "POST",
      headers: ct,
      body: JSON.stringify(p),
    }).then((r) => json<{ ok: true }>(r)),
  destroy: (id: string) =>
    fetch(`/gui/api/sandbox-session/${enc(id)}`, { method: "DELETE" }).then((
      r,
    ) => json<{ ok: true }>(r)),
};

const ct = { "Content-Type": "application/json" };
const enc = encodeURIComponent;
