/**
 * CF-compatible interface definitions for use in Node.js environments
 * (e.g., the takos-executor container).
 *
 * These are intentionally structural and a little more permissive than the
 * official Workers types because the proxy stubs emulate the binding contract
 * over HTTP rather than inside the Workers runtime.
 *
 * This is the single canonical source for CF type shims across all
 * takos-computer packages. Only the Durable Object and KV shapes the sandbox
 * host actually uses are kept here.
 */

// ---------------------------------------------------------------------------
// Durable Objects
// ---------------------------------------------------------------------------

export interface DurableObjectId {
  toString(): string;
  equals(other: DurableObjectId): boolean;
  readonly name?: string;
}

export interface DurableObjectStub<T = unknown> {
  id: DurableObjectId;
  name?: string;
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
  // RPC surface of the Durable Object class — `env.NS.get(id).someMethod()`
  // dispatches over the stub. Cloudflare types the property bag as the
  // intersection with the DO class itself; we mirror that so callers do not
  // need to bridge with `as unknown as DurableObjectStub & TheClass`.
}
export type DurableObjectStubOf<T> = DurableObjectStub<T> & T;

export interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  newUniqueId(): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStubOf<T>;
}

// ---------------------------------------------------------------------------
// KV Namespace
// ---------------------------------------------------------------------------

export interface KVNamespace {
  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get(key: string, options: { type: "json" }): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(
    options?: { prefix?: string; limit?: number; cursor?: string },
  ): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}
