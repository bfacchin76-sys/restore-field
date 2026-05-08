/**
 * Worker entrypoint. Run with:
 *   pnpm worker
 *
 * Per PRD §5/§13 the worker runs the same Next.js image with a different
 * command — but for dev we just use tsx and skip the Next runtime entirely.
 */
import "server-only";
import { Worker } from "bullmq";
import {
  QUEUE_DAILY_COUNTS,
  QUEUE_IMAGE_PROCESS,
  QUEUE_REPORT_GENERATE,
  scheduleDailyCountsCron,
  type DailyCountsJob,
  type ImageProcessJob,
  type ReportGenerateJob,
} from "./queues";
import { getRedis } from "./connection";
import { processImageJob } from "./processors/image-process";
import { processDailyCountsJob } from "./processors/daily-counts";
import { processReportGenerateJob } from "./processors/report-generate";
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

export function startReportGenerateWorker(): Worker<ReportGenerateJob> {
  const worker = new Worker<ReportGenerateJob>(
    QUEUE_REPORT_GENERATE,
    async (job) => processReportGenerateJob(job.data),
    {
      connection: getRedis(),
      // Puppeteer is heavy; cap concurrency.
      concurrency: 1,
    },
  );

  worker.on("ready", () => logger.info("report-generate worker ready"));
  worker.on("completed", (job) =>
    logger.info({ reportId: job.data.reportId }, "report generated"),
  );
  worker.on("failed", (job, err) =>
    logger.error(
      { reportId: job?.data.reportId, err: err.message, attempts: job?.attemptsMade },
      "report-generate failed",
    ),
  );

  return worker;
}

export function startDailyCountsWorker(): Worker<DailyCountsJob> {
  const worker = new Worker<DailyCountsJob>(
    QUEUE_DAILY_COUNTS,
    async (job) => processDailyCountsJob(job.data),
    {
      connection: getRedis(),
      concurrency: 1,
    },
  );

  worker.on("ready", async () => {
    logger.info("equipment-daily-counts worker ready");
    try {
      await scheduleDailyCountsCron();
      logger.info("equipment-daily-counts cron scheduled (00:05 UTC)");
    } catch (err) {
      logger.error({ err }, "failed to schedule daily-counts cron");
    }
  });
  worker.on("failed", (job, err) =>
    logger.error(
      { err: err.message, attempts: job?.attemptsMade },
      "equipment-daily-counts failed",
    ),
  );

  return worker;
}
