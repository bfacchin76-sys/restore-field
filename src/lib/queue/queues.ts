import "server-only";
import { Queue } from "bullmq";
import { getRedis } from "./connection";

export const QUEUE_IMAGE_PROCESS = "image-process";

export interface ImageProcessJob {
  photoId: string;
  /** Key of the uploaded blob in storage (e.g. tmp/{photoId}.jpg). */
  uploadKey: string;
  /** Reported MIME from the browser. */
  uploadedMime: string;
  /** Reported extension from the original filename. */
  uploadedExt: string;
}

let cachedImageQueue: Queue<ImageProcessJob> | null = null;

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
