/**
 * Run model resolver stub.
 *
 * TODO: Implement model resolution from the database.
 * The full implementation should query the workspace/space settings
 * to determine the preferred model for a given space.
 */
import type { SqlDatabaseBinding } from '../shared/types/bindings';

export async function resolveRunModel(
  _db: SqlDatabaseBinding,
  _spaceId: string,
  model?: string,
): Promise<string> {
  // TODO: Look up the space's configured default model from `_db` using `_spaceId`
  return model ?? 'gpt-5.4-nano';
}
