/**
 * Portable binding interfaces.
 *
 * In the original control package these resolve to Cloudflare Workers types
 * via @takos/cloudflare-compat. Here we define minimal structural interfaces
 * so the agent runner code compiles without a Cloudflare dependency.
 */

export interface SqlDatabaseBinding {
  prepare(query: string): SqlPreparedStatementBinding;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: SqlPreparedStatementBinding[]): Promise<SqlResultBinding<T>[]>;
  exec(query: string): Promise<SqlResultBinding>;
}

export interface SqlPreparedStatementBinding {
  bind(...values: unknown[]): SqlPreparedStatementBinding;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<SqlResultBinding<T>>;
  all<T = unknown>(): Promise<SqlResultBinding<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface SqlResultBinding<T = unknown> {
  results: T[];
  success: boolean;
  error?: string;
  meta?: Record<string, unknown>;
}

export type KvStoreBinding = {
  get(key: string, options?: { type?: string }): Promise<unknown>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
};

export type DurableObjectStubBinding<T = unknown> = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type DurableNamespaceBinding<T = unknown> = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubBinding<T>;
  getByName?(name: string): DurableObjectStubBinding<T>;
};

export type ObjectStoreBinding = {
  head(key: string): Promise<StoredObjectBinding | null>;
  get(key: string): Promise<ObjectBodyBinding | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | string, options?: Record<string, unknown>): Promise<StoredObjectBinding>;
  delete(key: string | string[]): Promise<void>;
  list(options?: Record<string, unknown>): Promise<{ objects: StoredObjectBinding[]; truncated: boolean; cursor?: string }>;
};

export type StoredObjectBinding = {
  key: string;
  size: number;
  etag?: string;
  uploaded?: Date;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
};

export type ObjectBodyBinding = StoredObjectBinding & {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
};

export type AiBinding = {
  run(model: string, input: unknown): Promise<unknown>;
};

export type QueueBinding<T = unknown> = {
  send(message: T): Promise<void>;
  sendBatch(messages: { body: T }[]): Promise<void>;
};

export type QueueMessageBatch<T = unknown> = {
  messages: { id: string; body: T; timestamp: Date; ack(): void; retry(): void }[];
  ackAll(): void;
  retryAll(): void;
};

export type VectorIndexBinding = {
  query(vector: number[], options?: Record<string, unknown>): Promise<{ matches: unknown[] }>;
  upsert(vectors: unknown[]): Promise<void>;
  insert(vectors: unknown[]): Promise<void>;
  deleteByIds(ids: string[]): Promise<void>;
};

export type ServiceBindingFetcher = {
  fetch(request: Request): Promise<Response>;
};

// Compat aliases
export type D1Database = SqlDatabaseBinding;
export type D1PreparedStatement = SqlPreparedStatementBinding;
export type D1Result<T = unknown> = SqlResultBinding<T>;
export type R2Bucket = ObjectStoreBinding;
export type R2Object = StoredObjectBinding;
export type R2ObjectBody = ObjectBodyBinding;
