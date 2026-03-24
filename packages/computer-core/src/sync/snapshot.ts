/**
 * Snapshot manager stub.
 */
import type { SnapshotTree } from './types';

export class SnapshotManager {
  constructor(_env: unknown, _spaceId: string) {}

  async writeBlob(content: string): Promise<{ hash: string; size: number }> {
    throw new Error('SnapshotManager.writeBlob not implemented in computer-core');
  }

  async createSnapshot(
    _tree: SnapshotTree,
    _parents: string[],
    _message: string,
    _author: string,
  ): Promise<{ id: string }> {
    throw new Error('SnapshotManager.createSnapshot not implemented in computer-core');
  }

  async getTree(_snapshotId: string): Promise<SnapshotTree> {
    throw new Error('SnapshotManager.getTree not implemented in computer-core');
  }

  async createTreeFromWorkspace(): Promise<SnapshotTree> {
    throw new Error('SnapshotManager.createTreeFromWorkspace not implemented in computer-core');
  }

  createBlobFetcher(): (hash: string) => Promise<string | null> {
    return async (_hash) => null;
  }

  async completeSnapshot(_snapshotId: string): Promise<void> {}
}
