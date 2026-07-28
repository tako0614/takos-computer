import { expect, test } from "bun:test";
import type {
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStorageTransaction,
} from "../cf-types.ts";
import { SessionQuotaCoordinator } from "../session-quota.ts";

class AtomicMemoryStorage implements DurableObjectStorage {
  private readonly values = new Map<string, unknown>();
  private tail: Promise<void> = Promise.resolve();

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(key) as T | undefined);
  }

  put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key));
  }

  transaction<T>(
    closure: (transaction: DurableObjectStorageTransaction) => Promise<T>,
  ): Promise<T> {
    const run = this.tail.then(() => closure(this));
    this.tail = run.then(() => {}, () => {});
    return run;
  }
}

function coordinator(): SessionQuotaCoordinator {
  return new SessionQuotaCoordinator({
    storage: new AtomicMemoryStorage(),
  } satisfies DurableObjectState);
}

test("SessionQuotaCoordinator admits at most the configured concurrent cap", async () => {
  const quota = coordinator();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      quota.reserve(`session-${index}`, 3)
    ),
  );

  expect(results.filter((result) => result.ok).length).toEqual(3);
  expect(results.filter((result) => !result.ok).length).toEqual(17);
});

test("SessionQuotaCoordinator makes retry and release idempotent", async () => {
  const quota = coordinator();

  expect(await quota.reserve("same-session", 1)).toMatchObject({
    ok: true,
    created: true,
    count: 1,
  });
  expect(await quota.reserve("same-session", 1)).toMatchObject({
    ok: true,
    created: false,
    count: 1,
  });
  expect((await quota.reserve("other-session", 1)).ok).toEqual(false);

  expect(await quota.release("same-session")).toEqual({ released: true });
  expect(await quota.release("same-session")).toEqual({ released: false });
  expect((await quota.reserve("other-session", 1)).ok).toEqual(true);
});
