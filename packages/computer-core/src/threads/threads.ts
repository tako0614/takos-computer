/**
 * Thread management stubs.
 */
import type { SqlDatabaseBinding } from '../shared/types/bindings.ts';

export async function createThread(
  _db: SqlDatabaseBinding,
  _spaceId: string,
  _options: { title?: string; locale?: string | null },
): Promise<{ id: string } | null> {
  throw new Error('createThread not implemented in computer-core');
}

export async function updateThreadStatus(
  _db: SqlDatabaseBinding,
  _threadId: string,
  _status: string,
): Promise<void> {
  throw new Error('updateThreadStatus not implemented in computer-core');
}
