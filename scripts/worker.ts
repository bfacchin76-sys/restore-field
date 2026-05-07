/**
 * Worker process — `pnpm worker` runs this. Long-lived; processes the
 * BullMQ image-process queue. Same image, different command (PRD §5/§13).
 */
import { startImageProcessWorker } from "../src/lib/queue/worker";

const worker = startImageProcessWorker();

async function shutdown(reason: string): Promise<never> {
  console.log(`[worker] shutting down (${reason})`);
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log("[worker] image-process worker started; waiting for jobs…");
