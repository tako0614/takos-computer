/**
 * Run model resolver stub.
 *
 * TODO(2026-03): Implement model resolution from the database.
 * The full implementation should query the workspace/space settings
 * to determine the preferred model for a given space.
 */
import type { SqlDatabaseBinding } from '../shared/types/bindings.ts';

export async function resolveRunModel(
  _db: SqlDatabaseBinding,
  _spaceId: string,
  model?: string,
): Promise<string> {
  // TODO(2026-03): Look up the space's configured default model from `_db` using `_spaceId`
  return model ?? 'gpt-5.4-nano';
}
