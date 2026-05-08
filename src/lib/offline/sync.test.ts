// @vitest-environment jsdom

/**
 * Phase 8 DoD walkthrough — drive the sync engine from a simulated
 * airplane-mode session.
 *
 *   1. Take navigator.onLine → false.
 *   2. enqueue 10 photos / 5 readings / 3 notes.
 *   3. Drain runs → finds nothing to send (offline).
 *   4. Flip navigator.onLine → true; emit `online` event.
 *   5. Stub each Server-Action import so the drain runs offline-friendly.
 *   6. Assert every queue empties to zero, no stuck items.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks — Vitest moves these above the imports so the dynamic
// imports inside `sync.ts` (which the engine uses for the per-kind
// syncers) resolve to our stubs instead of the real Server Actions.
let readingShouldFail = false;
vi.mock("@/app/app/jobs/[id]/photos/actions", () => ({
  presignPhotoUploads: vi.fn(async (input: { files: { mimeType: string }[] }) => ({
    ok: true,
    uploads: input.files.map((f, i: number) => ({
      photoId: `p-${i}`,
      url: "http://localhost/upload",
      headers: { "Content-Type": f.mimeType },
      uploadKey: `tmp/p-${i}.jpg`,
      mimeType: f.mimeType,
      size: 0,
      filename: "x",
    })),
  })),
  finalizePhotoUploads: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/app/jobs/[id]/moisture/actions", () => ({
  createReading: vi.fn(async () => {
    if (readingShouldFail) throw new Error("network down");
    return { ok: true, message: "Saved." };
  }),
}));
vi.mock("@/app/app/jobs/[id]/notes/actions", () => ({
  createNoteAction: vi.fn(async () => ({ ok: true, noteId: "n-x" })),
}));

import {
  _resetOfflineDbForTests,
  getOfflineDb,
} from "./db";
import {
  drain,
  enqueueNote,
  enqueuePhoto,
  enqueueReading,
  getQueueStats,
} from "./sync";

const tinyBlob = (n = 1024) =>
  new Blob([new Uint8Array(n)], { type: "image/jpeg" });

let onlineFlag = true;

beforeEach(async () => {
  readingShouldFail = false;
  _resetOfflineDbForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("fieldrestore");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => onlineFlag,
  });

  // Stub fetch — the photo-sync path PUTs the blob via fetch.
  globalThis.fetch = vi.fn(async () =>
    new Response("{}", { status: 200, headers: { "Content-Type": "text/plain" } }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetOfflineDbForTests();
});

describe("airplane-mode → reconnect (PRD §9 DoD)", () => {
  it("queues 10 photos, 5 readings, 3 notes offline; drains cleanly when online", async () => {
    onlineFlag = false;

    for (let i = 0; i < 10; i++) {
      await enqueuePhoto({
        jobId: "j-1",
        roomId: null,
        filename: `p${i}.jpg`,
        mimeType: "image/jpeg",
        size: 1024,
        blob: tinyBlob(),
        caption: null,
        tags: [],
        salvageability: null,
      });
    }
    for (let i = 0; i < 5; i++) {
      await enqueueReading({
        jobId: "j-1",
        roomId: null,
        surface: `wall-${i}`,
        material: "DRYWALL",
        meterType: "PIN",
        scaleType: "PERCENT_MC",
        moistureValue: 22 + i,
        ambientTempF: null,
        ambientRH: null,
        isDryGoal: false,
        isInitial: false,
        notes: null,
      });
    }
    for (let i = 0; i < 3; i++) {
      await enqueueNote({ jobId: "j-1", content: `note ${i}` });
    }

    let stats = await getQueueStats();
    expect(stats.queued).toBe(18); // 10 + 5 + 3
    expect(stats.online).toBe(false);

    // Offline drain is a no-op
    await drain();
    stats = await getQueueStats();
    expect(stats.queued).toBe(18);
    expect(stats.stuck).toBe(0);

    // Reconnect
    onlineFlag = true;
    await drain();

    stats = await getQueueStats();
    expect(stats.queued).toBe(0);
    expect(stats.syncing).toBe(0);
    expect(stats.stuck).toBe(0);

    // The Dexie tables should be empty (synced rows are deleted, not flagged).
    const db = getOfflineDb();
    expect(await db.queuedPhotos.count()).toBe(0);
    expect(await db.queuedReadings.count()).toBe(0);
    expect(await db.queuedNotes.count()).toBe(0);
  });

  it("getQueueStats categorises queued / syncing / stuck rows correctly", async () => {
    const db = getOfflineDb();
    const base = {
      jobId: "j",
      roomId: null,
      surface: "x",
      material: "DRYWALL" as const,
      meterType: "PIN" as const,
      scaleType: "PERCENT_MC" as const,
      moistureValue: 22,
      ambientTempF: null,
      ambientRH: null,
      isDryGoal: false,
      isInitial: false,
      notes: null,
      retryCount: 0,
      nextAttemptAt: 0,
      createdAt: Date.now(),
    };
    await db.queuedReadings.add({ ...base, status: "queued" });
    await db.queuedReadings.add({ ...base, status: "syncing" });
    await db.queuedReadings.add({ ...base, status: "stuck", retryCount: 8 });
    await db.queuedReadings.add({ ...base, status: "stuck", retryCount: 9 });

    onlineFlag = true;
    const stats = await getQueueStats();
    expect(stats.queued).toBe(1);
    expect(stats.syncing).toBe(1);
    expect(stats.stuck).toBe(2);
  });
});
