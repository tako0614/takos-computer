import { expect, test } from "bun:test";
import type { KVNamespace } from "../cf-types.ts";
import type { SandboxSessionState } from "../sandbox-session-types.ts";
import {
  countOwnerSessions,
  indexSession,
  listSessionStates,
  ownerIndexPrefix,
  sessionIndexKey,
  unindexSession,
} from "../session-index.ts";

/** KV double that paginates `list` in fixed-size pages (like Workers KV). */
class PagingKv implements KVNamespace {
  private values = new Map<string, string>();
  constructor(private pageSize = 2) {}

  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get(key: string, options: { type: "json" }): Promise<unknown>;
  get(
    key: string,
    options?: { type?: "text" | "json" },
  ): Promise<string | null | unknown> {
    const value = this.values.get(key) ?? null;
    if (options?.type === "json") {
      return Promise.resolve(value ? JSON.parse(value) : null);
    }
    return Promise.resolve(value);
  }

  put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  list(
    options?: { prefix?: string; limit?: number; cursor?: string },
  ): Promise<
    { keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }
  > {
    const all = [...this.values.keys()]
      .filter((name) => !options?.prefix || name.startsWith(options.prefix))
      .sort();
    const start = options?.cursor ? Number(options.cursor) : 0;
    const slice = all.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    const complete = next >= all.length;
    return Promise.resolve({
      keys: slice.map((name) => ({ name })),
      list_complete: complete,
      cursor: complete ? undefined : String(next),
    });
  }
}

function state(
  userId: string,
  sessionId: string,
): SandboxSessionState {
  return {
    sessionId,
    userId,
    spaceId: "space-1",
    status: "active",
    createdAt: "2026-04-20T00:00:00.000Z",
  };
}

test("listSessionStates follows the KV cursor across pages", async () => {
  const kv = new PagingKv(2);
  for (let i = 0; i < 5; i++) await indexSession(kv, state("user-a", `s${i}`));

  const all = await listSessionStates(kv, ownerIndexPrefix("user-a"));
  expect(all.length).toEqual(5); // not truncated to the first 2-key page
  expect(all.map((s) => s.sessionId).sort()).toEqual([
    "s0",
    "s1",
    "s2",
    "s3",
    "s4",
  ]);
});

test("owner prefix isolates one user's sessions from another's", async () => {
  const kv = new PagingKv(2);
  await indexSession(kv, state("user-a", "a1"));
  await indexSession(kv, state("user-a", "a2"));
  await indexSession(kv, state("user-b", "b1"));

  const a = await listSessionStates(kv, ownerIndexPrefix("user-a"));
  expect(a.map((s) => s.sessionId).sort()).toEqual(["a1", "a2"]);
  const b = await listSessionStates(kv, ownerIndexPrefix("user-b"));
  expect(b.map((s) => s.sessionId)).toEqual(["b1"]);
});

test("countOwnerSessions paginates and excludes published-scoped entries", async () => {
  const kv = new PagingKv(2);
  await indexSession(kv, state("user-a", "a1"));
  await indexSession(kv, state("user-a", "a2"));
  await indexSession(kv, state("user-a", "a3"));
  // A published-token holder planted a pmcp- session under user-a's owner; it
  // must not count against (or be claimable by) the GUI user.
  await indexSession(kv, state("user-a", "pmcp-deadbeef:planted"));

  expect(await countOwnerSessions(kv, "user-a")).toEqual(3);
});

test("unindexSession removes the owner-scoped key", async () => {
  const kv = new PagingKv(2);
  const s = state("user-a", "a1");
  await indexSession(kv, s);
  expect(await kv.get(sessionIndexKey(s))).not.toEqual(null);
  await unindexSession(kv, s);
  expect(await kv.get(sessionIndexKey(s))).toEqual(null);
});
