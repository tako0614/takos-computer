/**
 * Database stub — provides the drizzle helpers the agent files import.
 *
 * In the original control package this file wires up drizzle-orm to D1.
 * Here we export placeholder table references and a getDb that returns
 * a "typed drizzle" instance. Concrete implementations are expected to
 * be injected via the AgentRunnerIo seam.
 */

import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { SqlDatabaseBinding } from '../shared/types/bindings';

// Re-export drizzle-orm primitives so files that import them from here still work
export { eq, and, lt, gt, desc, asc, sql, inArray } from 'drizzle-orm';

/**
 * Async drizzle DB instance type used throughout the codebase.
 * Matches the shape returned by `drizzle(d1Binding, { schema })`.
 */
export type DrizzleDb = BaseSQLiteDatabase<'async', unknown>;

/**
 * Placeholder table definitions.
 * These carry enough shape for TypeScript but have no real schema.
 * At runtime, the agent runner should go through AgentRunnerIo.
 *
 * Typed as Record<string, unknown> to avoid `any` leaking into
 * consumer code while remaining assignable to drizzle table references.
 */
export const runs: Record<string, unknown> = {};
export const threads: Record<string, unknown> = {};
export const messages: Record<string, unknown> = {};
export const runEvents: Record<string, unknown> = {};
export const lgCheckpoints: Record<string, unknown> = {};
export const lgWrites: Record<string, unknown> = {};
export const sessions: Record<string, unknown> = {};
export const accounts: Record<string, unknown> = {};
export const accountMetadata: Record<string, unknown> = {};
export const files: Record<string, unknown> = {};
export const branches: Record<string, unknown> = {};
export const pullRequests: Record<string, unknown> = {};
export const prReviews: Record<string, unknown> = {};

/**
 * Get a drizzle DB instance from a D1 binding.
 * Returns a minimal typed wrapper. In production this should be replaced
 * with a real drizzle setup.
 */
export function getDb(db: SqlDatabaseBinding): DrizzleDb {
  // In production, this would return drizzle(db, { schema }).
  // For now we return a stub that will be replaced.
  return db as unknown as DrizzleDb;
}
