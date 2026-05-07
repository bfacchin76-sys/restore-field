/**
 * Worker entrypoint. Run with:
 *   pnpm worker
 *
 * Per PRD §5/§13 the worker runs the same Next.js image with a different
 * command — but for dev we just use tsx and skip the Next runtime entirely.
 */
import "server-only";
import { Worker } from "bullmq";
import { QUEUE_IMAGE_PROCESS, type ImageProcessJob } from "./queues";
import { getRedis } from "./connection";
import { processImageJob } from "./processors/image-process";
import { logger } from "@/lib/logger";

export function startImageProcessWorker(): Worker<ImageProcessJob> {
  const worker = new Worker<ImageProcessJob>(
    QUEUE_IMAGE_PROCESS,
    async (job) => processImageJob(job.data),
    {
      connection: getRedis(),
      concurrency: 4,
    },
  );

  worker.on("ready", () => logger.info("image-process worker ready"));
  worker.on("completed", (job) =>
    logger.info({ photoId: job.data.photoId }, "image processed"),
  );
  worker.on("failed", (job, err) =>
    logger.error(
      { photoId: job?.data.photoId, err: err.message, attempts: job?.attemptsMade },
      "image-process failed",
    ),
  );

  return worker;
}
