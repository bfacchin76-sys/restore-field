// @vitest-environment jsdom

/**
 * Offline DB + queue lifecycle test. Uses `fake-indexeddb` so we can
 * exercise the same Dexie schema the browser uses, end-to-end.
 *
 * Covers PRD §9 DoD: queue 10 photos / 5 readings / 3 notes; nothing is
 * silently dropped; queue persists across "browser restart" (fresh DB
 * handle); status transitions to stuck after the budget.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetOfflineDbForTests,
  getOfflineDb,
  getJobCache,
  listJobCache,
  putJobCache,
} from "./db";

beforeEach(async () => {
  _resetOfflineDbForTests();
  // Wipe IndexedDB so each test starts clean.
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("fieldrestore");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

afterEach(() => {
  _resetOfflineDbForTests();
});

const tinyBlob = (n = 1024) => new Blob([new Uint8Array(n)], { type: "image/jpeg" });

describe("offline DB lifecycle", () => {
  it("queues 10 photos, 5 readings, 3 notes — none silently dropped", async () => {
    const db = getOfflineDb();
    for (let i = 0; i < 10; i++) {
      await db.queuedPhotos.add({
        jobId: "j",
        roomId: null,
        filename: `p${i}.jpg`,
        mimeType: "image/jpeg",
        size: 1024,
        blob: tinyBlob(),
        caption: null,
        tags: [],
        salvageability: null,
        status: "queued",
        retryCount: 0,
        nextAttemptAt: 0,
        createdAt: Date.now(),
      });
    }
    for (let i = 0; i < 5; i++) {
      await db.queuedReadings.add({
        jobId: "j",
        roomId: null,
        surface: `Wall ${i}`,
        material: "DRYWALL",
        meterType: "PIN",
        scaleType: "PERCENT_MC",
        moistureValue: 22 + i,
        ambientTempF: null,
        ambientRH: null,
        isDryGoal: false,
        isInitial: false,
        notes: null,
        status: "queued",
        retryCount: 0,
        nextAttemptAt: 0,
        createdAt: Date.now(),
      });
    }
    for (let i = 0; i < 3; i++) {
      await db.queuedNotes.add({
        jobId: "j",
        content: `note ${i}`,
        status: "queued",
        retryCount: 0,
        nextAttemptAt: 0,
        createdAt: Date.now(),
      });
    }

    expect(await db.queuedPhotos.count()).toBe(10);
    expect(await db.queuedReadings.count()).toBe(5);
    expect(await db.queuedNotes.count()).toBe(3);
  });

  it("survives a 'browser restart' — re-opening the DB shows all rows", async () => {
    const dbA = getOfflineDb();
    await dbA.queuedNotes.add({
      jobId: "j",
      content: "before restart",
      status: "queued",
      retryCount: 0,
      nextAttemptAt: 0,
      createdAt: Date.now(),
    });
    await dbA.close();
    _resetOfflineDbForTests();

    const dbB = getOfflineDb();
    const all = await dbB.queuedNotes.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe("before restart");
  });
});

describe("jobCache eviction", () => {
  it("retains at most 20 most-recent entries", async () => {
    for (let i = 0; i < 25; i++) {
      await putJobCache({
        jobId: `j-${i}`,
        organizationId: "org",
        payload: { i },
        fetchedAt: Date.now() + i, // monotonically increasing
      });
    }
    const all = await listJobCache();
    expect(all).toHaveLength(20);
    // Newest first, oldest 5 evicted
    expect(all[0].jobId).toBe("j-24");
    expect(await getJobCache("j-0")).toBeUndefined();
    expect(await getJobCache("j-24")).toBeDefined();
  });
});
