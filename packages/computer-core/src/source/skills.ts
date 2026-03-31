/**
 * Custom skill loader stub.
 */
import type { SqlDatabaseBinding } from '../shared/types/bindings.ts';

export async function listEnabledCustomSkillContext(
  _db: SqlDatabaseBinding,
  _spaceId: string,
): Promise<any[]> {
  return [];
}
