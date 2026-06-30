/**
 * SESSION_INDEX helpers — the single chokepoint for the Capsule-wide sandbox
 * session index.
 *
 * The index keys by `session:<owner>:<id>` so a GUI caller can list / count
 * only its own sessions (`prefix: session:<owner>:`) instead of scanning every
 * tenant's entries, while an admin can still list everything (`prefix:
 * session:`). The stored value is the full {@link SandboxSessionState}; its
 * `sessionId` is the Durable Object name, so the worker can drive
 * list -> get -> destroy round-trips off the stored value alone. Keeping the
 * keying + paging in one place stops the four ad-hoc call sites (two paths,
 * create + destroy each) from drifting.
 */

import type { KVNamespace } from "./cf-types.ts";
import {
  isPublishedScopedId,
  type SandboxSessionState,
} from "./sandbox-session-types.ts";

export const SESSION_INDEX_GLOBAL_PREFIX = "session:";

type SessionIndexKeyInput = Pick<SandboxSessionState, "userId" | "sessionId">;

function ownerSegment(userId: string): string {
  return encodeURIComponent(userId);
}

export function sessionIndexKey(input: SessionIndexKeyInput): string {
  return `${SESSION_INDEX_GLOBAL_PREFIX}${ownerSegment(input.userId)}:${input.sessionId}`;
}

export function ownerIndexPrefix(userId: string): string {
  return `${SESSION_INDEX_GLOBAL_PREFIX}${ownerSegment(userId)}:`;
}

export async function indexSession(
  kv: KVNamespace,
  state: SandboxSessionState,
): Promise<void> {
  await kv.put(sessionIndexKey(state), JSON.stringify(state));
}

export async function unindexSession(
  kv: KVNamespace,
  input: SessionIndexKeyInput,
): Promise<void> {
  await kv.delete(sessionIndexKey(input));
}

/**
 * Page through every index entry under `prefix`, following the KV cursor until
 * `list_complete` so results past the first ~1000-key page are not silently
 * dropped.
 */
export async function listSessionStates(
  kv: KVNamespace,
  prefix: string,
): Promise<SandboxSessionState[]> {
  const out: SandboxSessionState[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor });
    for (const key of page.keys) {
      const value = await kv.get(key.name, { type: "json" }) as
        | SandboxSessionState
        | null;
      if (value) out.push(value);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/**
 * Count the live sandbox sessions a GUI principal owns (cursor-paginated key
 * count, no per-key value read). Published-MCP-scoped entries that a published
 * token holder may have planted under this owner are excluded so they cannot
 * inflate (or starve) a GUI user's quota.
 */
export async function countOwnerSessions(
  kv: KVNamespace,
  userId: string,
): Promise<number> {
  const prefix = ownerIndexPrefix(userId);
  let count = 0;
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor });
    for (const key of page.keys) {
      if (isPublishedScopedId(key.name.slice(prefix.length))) continue;
      count += 1;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return count;
}
