/**
 * Checkpoint recovery and cleanup operations for LangGraph D1 persistence.
 *
 * Standalone functions that operate on the D1 database directly,
 * extracted from D1CheckpointSaver to separate recovery concerns from I/O.
 */

import { getDb, lgCheckpoints, lgWrites } from '../../infra/db';
import { eq, and, desc } from 'drizzle-orm';
import { InternalError } from '../../shared/utils/error-response';
import { logError, logInfo } from '../../shared/utils/logger';
import type { SqlDatabaseBinding } from '../../shared/types/bindings';

// ── Types ────────────────────────────────────────────────────────────────

/** Minimal serde interface needed for corruption detection. */
export interface CheckpointDeserializer {
  loadsTyped(type: string, data: Uint8Array): Promise<unknown>;
}

export interface RecoveryResult {
  recovered: boolean;
  cleanedWrites: number;
  resetToParent: boolean;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Extract a human-readable message from an unknown error. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Decode a base64 string to Uint8Array. (Kept local to avoid circular import with langgraph-checkpointer.) */
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

// ── Recovery functions ───────────────────────────────────────────────────

/** Delete all checkpoints and writes for a thread. */
export async function deleteThread(
  db: SqlDatabaseBinding,
  threadId: string,
): Promise<void> {
  try {
    const drizzle = getDb(db);
    await drizzle.delete(lgWrites).where(eq(lgWrites.threadId, threadId));
    await drizzle.delete(lgCheckpoints).where(eq(lgCheckpoints.threadId, threadId));
  } catch (error) {
    const errorMsg = errorMessage(error);
    throw new InternalError(`Failed to delete thread checkpoints: ${errorMsg}`);
  }
}

/**
 * Attempt to recover from checkpoint corruption.
 *
 * Identifies and removes corrupted pending writes, or resets to parent checkpoint
 * if the core checkpoint data itself is corrupted.
 *
 * @param db       - D1 database binding
 * @param serde    - deserializer used to probe data integrity
 * @param threadId - thread to recover
 * @param checkpointNs - checkpoint namespace (default: '')
 * @param checkpointId - specific checkpoint to recover, or latest if omitted
 */
export async function recoverCorruptedCheckpoint(
  db: SqlDatabaseBinding,
  serde: CheckpointDeserializer,
  threadId: string,
  checkpointNs: string = '',
  checkpointId?: string,
): Promise<RecoveryResult> {
  try {
    const drizzle = getDb(db);

    const row = checkpointId
      ? await drizzle.select().from(lgCheckpoints).where(
          and(
            eq(lgCheckpoints.threadId, threadId),
            eq(lgCheckpoints.checkpointNs, checkpointNs),
            eq(lgCheckpoints.checkpointId, checkpointId),
          )
        ).get()
      : await drizzle.select().from(lgCheckpoints).where(
          and(
            eq(lgCheckpoints.threadId, threadId),
            eq(lgCheckpoints.checkpointNs, checkpointNs),
          )
        ).orderBy(desc(lgCheckpoints.ts)).get();

    if (!row) {
      return { recovered: false, cleanedWrites: 0, resetToParent: false, error: 'Checkpoint not found' };
    }

    // ── Check core checkpoint data integrity ────────────────────────────
    try {
      await serde.loadsTyped(row.checkpointType, fromBase64(row.checkpointData));
    } catch {
      logError(`Core checkpoint ${row.checkpointId} is corrupted, resetting to parent`, undefined, { module: 'd1checkpointer' });

      if (row.parentCheckpointId) {
        // Delete this corrupted checkpoint and its writes
        await drizzle.delete(lgWrites).where(
          and(
            eq(lgWrites.threadId, threadId),
            eq(lgWrites.checkpointId, row.checkpointId),
          )
        );
        await drizzle.delete(lgCheckpoints).where(
          and(
            eq(lgCheckpoints.threadId, threadId),
            eq(lgCheckpoints.checkpointNs, checkpointNs),
            eq(lgCheckpoints.checkpointId, row.checkpointId),
          )
        );

        return {
          recovered: true,
          cleanedWrites: 0,
          resetToParent: true,
          error: `Corrupted checkpoint deleted, will resume from parent: ${row.parentCheckpointId}`,
        };
      } else {
        return {
          recovered: false,
          cleanedWrites: 0,
          resetToParent: false,
          error: 'Root checkpoint is corrupted and cannot be recovered',
        };
      }
    }

    // ── Check pending writes integrity ──────────────────────────────────
    const writes = await drizzle.select({
      taskId: lgWrites.taskId,
      channel: lgWrites.channel,
      valueType: lgWrites.valueType,
      valueData: lgWrites.valueData,
    }).from(lgWrites).where(
      and(
        eq(lgWrites.threadId, threadId),
        eq(lgWrites.checkpointNs, checkpointNs),
        eq(lgWrites.checkpointId, row.checkpointId),
      )
    ).all();

    const corruptedWrites: Array<{ taskId: string; channel: string }> = [];

    for (const w of writes) {
      try {
        await serde.loadsTyped(w.valueType, fromBase64(w.valueData));
      } catch {
        corruptedWrites.push({ taskId: w.taskId, channel: w.channel });
      }
    }

    if (corruptedWrites.length === 0) {
      return { recovered: true, cleanedWrites: 0, resetToParent: false };
    }

    for (const write of corruptedWrites) {
      await drizzle.delete(lgWrites).where(
        and(
          eq(lgWrites.threadId, threadId),
          eq(lgWrites.checkpointNs, checkpointNs),
          eq(lgWrites.checkpointId, row.checkpointId),
          eq(lgWrites.taskId, write.taskId),
          eq(lgWrites.channel, write.channel),
        )
      );
    }

    logInfo(`Recovered checkpoint ${row.checkpointId}: ` +
      `deleted ${corruptedWrites.length} corrupted writes from channels: ${corruptedWrites.map(w => w.channel).join(', ')}`, { module: 'd1checkpointer' });

    return {
      recovered: true,
      cleanedWrites: corruptedWrites.length,
      resetToParent: false,
    };
  } catch (error) {
    const errorMsg = errorMessage(error);
    return {
      recovered: false,
      cleanedWrites: 0,
      resetToParent: false,
      error: `Recovery failed: ${errorMsg}`,
    };
  }
}
