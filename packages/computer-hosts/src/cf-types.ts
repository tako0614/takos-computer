/**
 * Cloudflare Workers type definitions used by container hosts.
 * Minimal subset — avoids dependency on @cloudflare/workers-types at runtime.
 */

export interface DurableObjectState {
  storage: DurableObjectStorage;
  id: { toString(): string };
}

export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean | void>;
}

export interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): { toString(): string };
  get(id: unknown): DurableObjectStub & T;
  getByName?(name: string): DurableObjectStub & T;
}

export interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: unknown, options?: Record<string, unknown>): Promise<R2Object>;
  delete(key: string): Promise<void>;
  list(options?: Record<string, unknown>): Promise<unknown>;
  head(key: string): Promise<R2Object | null>;
}

export interface R2Object {
  body: ReadableStream;
  size: number;
  etag: string;
  uploaded: Date;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
  exec(sql: string): Promise<unknown>;
}

export interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
  all(): Promise<{ results: unknown[] }>;
  raw(options?: { columnNames?: boolean }): Promise<unknown[][]>;
}

export interface Queue<T = unknown> {
  send(message: T): Promise<void>;
  sendBatch(messages: { body: T }[]): Promise<void>;
}

export interface VectorizeIndex {
  query(vector: number[], options?: Record<string, unknown>): Promise<unknown>;
  insert(vectors: unknown[]): Promise<unknown>;
  upsert(vectors: unknown[]): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
  getByIds(ids: string[]): Promise<unknown>;
  describe(): Promise<unknown>;
}
