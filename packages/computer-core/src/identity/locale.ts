/**
 * Workspace locale stub.
 */
import type { SqlDatabaseBinding } from '../shared/types/bindings';

export async function getWorkspaceLocale(
  _db: SqlDatabaseBinding,
  _spaceId: string,
): Promise<string | null> {
  return null;
}
