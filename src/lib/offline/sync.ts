/**
 * Offline sync engine.
 *
 *   • Listens for `online` events + a 30 s heartbeat.
 *   • Drains queues serially (photos first, readings + notes in parallel
 *     after — photos are I/O-heavy; serialising the photo queue avoids
 *     hammering MinIO from a flaky connection).
 *   • Per-item retries follow `backoff.ts`. Items exceeding the 24 h
 *     budget flip to status="stuck" — surfaced on /app/admin/sync.
 *   • Subscribes notifies callers of queue stats so the header dot
 *     updates live.
 *
 * The sync layer never throws to its callers — every failure is captured
 * on the queue row and turned into a status change.
 */

"use client";

import { getOfflineDb } from "./db";
import { nextDelayMs, shouldGiveUp } from "./backoff";
import type { QueuedNote, QueuedPhoto, QueuedReading } from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface QueueStats {
  /** Items still pending sync (status "queued" with a future nextAttemptAt). */
  queued: number;
  /** Items currently being synced or being attempted. */
  syncing: number;
  /** Items past their retry budget. */
  stuck: number;
  /** Whether navigator.onLine returned true at last check. */
  online: boolean;
}

type Listener = (s: QueueStats) => void;
const listeners = new Set<Listener>();

let started = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  void notify();
  return () => listeners.delete(listener);
}

async function notify() {
  if (listeners.size === 0) return;
  const stats = await getQueueStats();
  for (const l of listeners) l(stats);
}

export async function getQueueStats(): Promise<QueueStats> {
  if (typeof indexedDB === "undefined") {
    return { queued: 0, syncing: 0, stuck: 0, online: true };
  }
  const db = getOfflineDb();
  const [pq, ps, pStuck, rq, rs, rStuck, nq, ns, nStuck] = await Promise.all([
    db.queuedPhotos.where("status").equals("queued").count(),
    db.queuedPhotos.where("status").equals("syncing").count(),
    db.queuedPhotos.where("status").equals("stuck").count(),
    db.queuedReadings.where("status").equals("queued").count(),
    db.queuedReadings.where("status").equals("syncing").count(),
    db.queuedReadings.where("status").equals("stuck").count(),
    db.queuedNotes.where("status").equals("queued").count(),
    db.queuedNotes.where("status").equals("syncing").count(),
    db.queuedNotes.where("status").equals("stuck").count(),
  ]);
  return {
    queued: pq + rq + nq,
    syncing: ps + rs + ns,
    stuck: pStuck + rStuck + nStuck,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
  };
}

/** Boot the engine. Idempotent — call from a layout once. */
export function startSyncEngine(): void {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => void drain());
  window.addEventListener("offline", () => void notify());
  intervalHandle = setInterval(() => {
    void drain();
  }, 30_000);
  void drain();
}

export function stopSyncEngine(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  started = false;
}

// ---------------------------------------------------------------------------
// Enqueue helpers — called from the action stubs when offline
// ---------------------------------------------------------------------------

export async function enqueuePhoto(
  input: Omit<
    QueuedPhoto,
    "id" | "status" | "retryCount" | "nextAttemptAt" | "createdAt"
  >,
): Promise<number> {
  const id = await getOfflineDb().queuedPhotos.add({
    ...input,
    status: "queued",
    retryCount: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  });
  void drain();
  return id as number;
}

export async function enqueueReading(
  input: Omit<
    QueuedReading,
    "id" | "status" | "retryCount" | "nextAttemptAt" | "createdAt"
  >,
): Promise<number> {
  const id = await getOfflineDb().queuedReadings.add({
    ...input,
    status: "queued",
    retryCount: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  });
  void drain();
  return id as number;
}

export async function enqueueNote(
  input: Omit<
    QueuedNote,
    "id" | "status" | "retryCount" | "nextAttemptAt" | "createdAt"
  >,
): Promise<number> {
  const id = await getOfflineDb().queuedNotes.add({
    ...input,
    status: "queued",
    retryCount: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  });
  void drain();
  return id as number;
}

// ---------------------------------------------------------------------------
// Drain
// ---------------------------------------------------------------------------

export async function drain(): Promise<void> {
  if (inFlight) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await notify();
    return;
  }
  inFlight = true;
  try {
    await drainNotes();
    await drainReadings();
    await drainPhotos();
  } finally {
    inFlight = false;
    await notify();
  }
}

async function drainPhotos(): Promise<void> {
  const db = getOfflineDb();
  const now = Date.now();
  const items = await db.queuedPhotos
    .where("status")
    .equals("queued")
    .filter((i) => i.nextAttemptAt <= now)
    .sortBy("createdAt");
  for (const item of items) {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    await syncOne(
      "queuedPhotos",
      item,
      async () => {
        await syncPhoto(item);
      },
    );
  }
}

async function drainReadings(): Promise<void> {
  const db = getOfflineDb();
  const now = Date.now();
  const items = await db.queuedReadings
    .where("status")
    .equals("queued")
    .filter((i) => i.nextAttemptAt <= now)
    .sortBy("createdAt");
  await Promise.all(
    items.map((item) =>
      syncOne("queuedReadings", item, async () => {
        await syncReading(item);
      }),
    ),
  );
}

async function drainNotes(): Promise<void> {
  const db = getOfflineDb();
  const now = Date.now();
  const items = await db.queuedNotes
    .where("status")
    .equals("queued")
    .filter((i) => i.nextAttemptAt <= now)
    .sortBy("createdAt");
  await Promise.all(
    items.map((item) =>
      syncOne("queuedNotes", item, async () => {
        await syncNote(item);
      }),
    ),
  );
}

type Table = "queuedPhotos" | "queuedReadings" | "queuedNotes";

async function syncOne(
  table: Table,
  item: { id?: number; retryCount: number; createdAt: number },
  fn: () => Promise<void>,
): Promise<void> {
  const db = getOfflineDb();
  if (item.id == null) return;
  await db.table(table).update(item.id, { status: "syncing" });
  await notify();
  try {
    await fn();
    // success → drop the row from the queue
    await db.table(table).delete(item.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const newRetry = item.retryCount + 1;
    if (shouldGiveUp(newRetry)) {
      await db.table(table).update(item.id, {
        status: "stuck",
        retryCount: newRetry,
        lastError: message,
      });
    } else {
      await db.table(table).update(item.id, {
        status: "queued",
        retryCount: newRetry,
        lastError: message,
        nextAttemptAt: Date.now() + nextDelayMs(newRetry),
      });
    }
  } finally {
    await notify();
  }
}

// ---------------------------------------------------------------------------
// Per-kind sync via Server Actions
// ---------------------------------------------------------------------------

async function syncPhoto(item: QueuedPhoto): Promise<void> {
  const { presignPhotoUploads, finalizePhotoUploads } = await import(
    "@/app/app/jobs/[id]/photos/actions"
  );
  const r = await presignPhotoUploads({
    jobId: item.jobId,
    files: [
      {
        filename: item.filename,
        mimeType: item.mimeType,
        size: item.size,
      },
    ],
  });
  if (!r.ok) throw new Error(r.message);
  const slot = r.uploads[0];
  // Direct PUT — same XHR that PhotoUploader does.
  const putRes = await fetch(slot.url, {
    method: "PUT",
    headers: slot.headers,
    body: item.blob,
  });
  if (!putRes.ok) {
    throw new Error(`upload PUT ${putRes.status}`);
  }
  const fin = await finalizePhotoUploads({
    jobId: item.jobId,
    uploads: [
      {
        photoId: slot.photoId,
        uploadKey: slot.uploadKey,
        mimeType: slot.mimeType,
        roomId: item.roomId ?? null,
        caption: item.caption ?? undefined,
      },
    ],
  });
  if (!fin.ok) throw new Error(fin.message ?? "finalize failed");
}

async function syncReading(item: QueuedReading): Promise<void> {
  // The reading Server Action expects FormData. Build it.
  const fd = new FormData();
  fd.set("jobId", item.jobId);
  if (item.roomId) fd.set("roomId", item.roomId);
  fd.set("surface", item.surface);
  fd.set("material", item.material);
  fd.set("meterType", item.meterType);
  fd.set("scaleType", item.scaleType);
  fd.set("moistureValue", String(item.moistureValue));
  if (item.ambientTempF != null) fd.set("ambientTempF", String(item.ambientTempF));
  if (item.ambientRH != null) fd.set("ambientRH", String(item.ambientRH));
  if (item.isDryGoal) fd.set("isDryGoal", "true");
  if (item.isInitial) fd.set("isInitial", "true");
  if (item.notes) fd.set("notes", item.notes);

  const { createReading } = await import(
    "@/app/app/jobs/[id]/moisture/actions"
  );
  const r = await createReading({ ok: false }, fd);
  if (!r.ok) throw new Error(r.message ?? "createReading failed");
}

async function syncNote(item: QueuedNote): Promise<void> {
  const { createNoteAction } = await import(
    "@/app/app/jobs/[id]/notes/actions"
  );
  const r = await createNoteAction({
    jobId: item.jobId,
    content: item.content,
  });
  if (!r.ok) throw new Error(r.message ?? "createNote failed");
}

// ---------------------------------------------------------------------------
// Stuck-items management (used by the admin page)
// ---------------------------------------------------------------------------

export async function listStuckItems() {
  const db = getOfflineDb();
  const [photos, readings, notes] = await Promise.all([
    db.queuedPhotos.where("status").equals("stuck").toArray(),
    db.queuedReadings.where("status").equals("stuck").toArray(),
    db.queuedNotes.where("status").equals("stuck").toArray(),
  ]);
  return { photos, readings, notes };
}

export async function retryStuckItem(
  table: Table,
  id: number,
): Promise<void> {
  const db = getOfflineDb();
  await db.table(table).update(id, {
    status: "queued",
    retryCount: 0,
    nextAttemptAt: Date.now(),
    lastError: null,
  });
  void drain();
  await notify();
}

export async function discardStuckItem(
  table: Table,
  id: number,
): Promise<void> {
  await getOfflineDb().table(table).delete(id);
  await notify();
}
