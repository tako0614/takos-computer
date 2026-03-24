/**
 * Database stub — provides the drizzle helpers the agent files import.
 *
 * In the original control package this file wires up drizzle-orm to D1.
 * Here we export placeholder table references and a getDb that returns
 * a "typed drizzle" instance. Concrete implementations are expected to
 * be injected via the AgentRunnerIo seam.
 */

import type { SqlDatabaseBinding } from '../shared/types/bindings';

// Re-export drizzle-orm primitives so files that import them from here still work
export { eq, and, lt, gt, desc, asc, sql, inArray } from 'drizzle-orm';

/**
 * Placeholder table definitions.
 * These carry enough shape for TypeScript but have no real schema.
 * At runtime, the agent runner should go through AgentRunnerIo.
 */
export const runs: any = {};
export const threads: any = {};
export const messages: any = {};
export const runEvents: any = {};
export const lgCheckpoints: any = {};
export const lgWrites: any = {};
export const sessions: any = {};
export const accounts: any = {};
export const accountMetadata: any = {};
export const files: any = {};
export const branches: any = {};
export const pullRequests: any = {};
export const prReviews: any = {};

/**
 * Get a drizzle DB instance from a D1 binding.
 * Returns a minimal typed wrapper. In production this should be replaced
 * with a real drizzle setup.
 */
export function getDb(db: SqlDatabaseBinding): any {
  // In production, this would return drizzle(db, { schema }).
  // For now we return a stub that will be replaced.
  return db as any;
}
