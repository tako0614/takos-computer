/**
 * Run model resolver stub.
 */
import type { SqlDatabaseBinding } from '../shared/types/bindings';

export async function resolveRunModel(
  _db: SqlDatabaseBinding,
  _spaceId: string,
  _model?: string,
): Promise<string> {
  return _model ?? 'gpt-5.4-nano';
}
