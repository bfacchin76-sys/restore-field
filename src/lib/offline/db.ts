/**
 * Dexie wrapper for the offline queue + cached job summaries.
 *
 *   queuedPhotos / queuedReadings / queuedNotes:
 *     write-when-offline queue. Photos store the actual Blob; readings &
 *     notes are pure JSON. The `status` field drives the sync engine —
 *     queued → syncing → synced (then deleted) or stuck (after the
 *     STUCK_HOURS budget is exceeded).
 *
 *   jobCache:
 *     Aggressive last-20-jobs cache so the app can render most recent
 *     pages offline. PRD §9.
 */

import Dexie, { type Table } from "dexie";
import type {
  CachedJobSummary,
  QueuedNote,
  QueuedPhoto,
  QueuedReading,
} from "./types";

export class OfflineDB extends Dexie {
  queuedPhotos!: Table<QueuedPhoto, number>;
  queuedReadings!: Table<QueuedReading, number>;
  queuedNotes!: Table<QueuedNote, number>;
  jobCache!: Table<CachedJobSummary, string>;

  constructor() {
    super("fieldrestore");
    this.version(1).stores({
      // ++id = auto-increment primary key. Indexed fields after the
      // PK help filter queries (status for sync drain, jobId for UI).
      queuedPhotos: "++id, status, jobId, nextAttemptAt, createdAt",
      queuedReadings: "++id, status, jobId, nextAttemptAt, createdAt",
      queuedNotes: "++id, status, jobId, nextAttemptAt, createdAt",
      jobCache: "jobId, organizationId, fetchedAt",
    });
  }
}

let cached: OfflineDB | null = null;

export function getOfflineDb(): OfflineDB {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB not available — offline queue is browser-only");
  }
  if (!cached) cached = new OfflineDB();
  return cached;
}

/** Test-only — recreate the singleton between specs. */
export function _resetOfflineDbForTests(): void {
  if (cached) {
    void cached.close();
    cached = null;
  }
}

// =============================================================================
// Job cache: keep last N entries by fetchedAt
// =============================================================================

const JOB_CACHE_MAX = 20;

export async function putJobCache(entry: CachedJobSummary): Promise<void> {
  const db = getOfflineDb();
  await db.jobCache.put(entry);
  // Trim to N entries
  const all = await db.jobCache.orderBy("fetchedAt").reverse().toArray();
  if (all.length > JOB_CACHE_MAX) {
    const drop = all.slice(JOB_CACHE_MAX).map((e) => e.jobId);
    await db.jobCache.bulkDelete(drop);
  }
}

export async function getJobCache(jobId: string): Promise<CachedJobSummary | undefined> {
  return getOfflineDb().jobCache.get(jobId);
}

export async function listJobCache(): Promise<CachedJobSummary[]> {
  return getOfflineDb().jobCache.orderBy("fetchedAt").reverse().toArray();
}
