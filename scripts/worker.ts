/**
 * Worker process — `pnpm worker` runs this. Long-lived; processes the
 * BullMQ image-process, equipment-daily-counts, and report-generate
 * queues. Same image, different command (PRD §5/§13).
 */
import {
  startDailyCountsWorker,
  startImageProcessWorker,
  startReportGenerateWorker,
} from "../src/lib/queue/worker";

const imageWorker = startImageProcessWorker();
const dailyCountsWorker = startDailyCountsWorker();
const reportWorker = startReportGenerateWorker();

async function shutdown(reason: string): Promise<never> {
  console.log(`[worker] shutting down (${reason})`);
  await Promise.all([
    imageWorker.close(),
    dailyCountsWorker.close(),
    reportWorker.close(),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log(
  "[worker] image-process + equipment-daily-counts + report-generate workers started; waiting for jobs…",
);
