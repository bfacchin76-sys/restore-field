import "server-only";
import { Queue } from "bullmq";
import { getRedis } from "./connection";

export const QUEUE_IMAGE_PROCESS = "image-process";
export const QUEUE_DAILY_COUNTS = "equipment-daily-counts";

export interface ImageProcessJob {
  photoId: string;
  /** Key of the uploaded blob in storage (e.g. tmp/{photoId}.jpg). */
  uploadKey: string;
  /** Reported MIME from the browser. */
  uploadedMime: string;
  /** Reported extension from the original filename. */
  uploadedExt: string;
}

export interface DailyCountsJob {
  /** ISO date for the day being snapshotted (yyyy-mm-dd UTC). */
  day: string;
}

let cachedImageQueue: Queue<ImageProcessJob> | null = null;
let cachedDailyCountsQueue: Queue<DailyCountsJob> | null = null;

export function getImageProcessQueue(): Queue<ImageProcessJob> {
  if (cachedImageQueue) return cachedImageQueue;
  cachedImageQueue = new Queue<ImageProcessJob>(QUEUE_IMAGE_PROCESS, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    },
  });
  return cachedImageQueue;
}

export function getDailyCountsQueue(): Queue<DailyCountsJob> {
  if (cachedDailyCountsQueue) return cachedDailyCountsQueue;
  cachedDailyCountsQueue = new Queue<DailyCountsJob>(QUEUE_DAILY_COUNTS, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100 },
      removeOnFail: { age: 30 * 24 * 60 * 60 },
    },
  });
  return cachedDailyCountsQueue;
}

/**
 * Schedule the daily-counts BullMQ repeat job. Called once at worker boot
 * (PRD §8.5: "Daily count cron (BullMQ repeat job at midnight org-local
 * time)"). Idempotent — uses a deterministic jobId.
 */
export async function scheduleDailyCountsCron(): Promise<void> {
  const q = getDailyCountsQueue();
  // Run every day at 00:05 UTC. We don't have per-org timezones in v1;
  // PRD §8.5 calls for org-local time but with one tenant in NY the day
  // boundary is close enough at 00:05 UTC = 8:05 PM EST.
  await q.upsertJobScheduler(
    "equipment-daily-counts-daily",
    { pattern: "5 0 * * *" },
    {
      name: "snapshot",
      data: { day: new Date().toISOString().slice(0, 10) },
    },
  );
}
