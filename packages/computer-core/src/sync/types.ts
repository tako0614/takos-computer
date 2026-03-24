/**
 * Sync / snapshot types stub.
 */
export type SnapshotTree = Record<string, { hash: string; size: number; mode: number; type: 'file' | 'symlink' }>;
