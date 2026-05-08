import "server-only";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { renderReportPdf } from "@/lib/reports/render";
import { logger } from "@/lib/logger";
import { isValidReportSnapshot } from "@/lib/reports/snapshot-shape";
import type { ReportSnapshot } from "@/lib/reports/types";
import type { ReportGenerateJob } from "../queues";

/**
 * Worker pipeline for the report-generate queue:
 *   1. Load the Report row (snapshot already populated by the Server Action).
 *   2. Validate the snapshot shape so an evolved schema doesn't poison-pill
 *      the queue with `undefined.map()` errors (audit M3).
 *   3. Render snapshot → letter PDF.
 *   4. Upload to storage at reports/{orgId}/{jobId}/{reportId}.pdf.
 *   5. Stamp the Report row with the final pdfStorageKey + clear errors.
 *
 * Failure path persists `processingError` and bumps `processingAttempts`
 * (audit M4) so operators can see why a row is stuck without grepping
 * worker logs. The error is then re-thrown so BullMQ's exponential
 * backoff still retries the documented number of times.
 */
export async function processReportGenerateJob(
  data: ReportGenerateJob,
): Promise<void> {
  const report = await prisma.report.findUnique({
    where: { id: data.reportId },
    include: { job: { select: { organizationId: true } } },
  });
  if (!report) {
    logger.warn({ reportId: data.reportId }, "report-generate: row missing");
    return;
  }

  // Bump attempts up front so a process crash mid-render still leaves
  // operators an audit trail.
  await prisma.report.update({
    where: { id: report.id },
    data: { processingAttempts: { increment: 1 }, processingError: null },
  });

  try {
    const snapshot = report.dataSnapshot as unknown as ReportSnapshot;
    const validation = isValidReportSnapshot(snapshot);
    if (!validation.ok) {
      throw new Error(`Invalid snapshot shape: ${validation.reason}`);
    }

    const pdf = await renderReportPdf(snapshot);

    const orgId = report.job.organizationId;
    const finalKey = `reports/${orgId}/${report.jobId}/${report.id}.pdf`;

    const storage = getStorage();
    await storage.putObjectBytes(finalKey, pdf, "application/pdf");

    await prisma.report.update({
      where: { id: report.id },
      data: { pdfStorageKey: finalKey, processingError: null },
    });

    logger.info(
      { reportId: report.id, sizeBytes: pdf.length, type: report.type },
      "report generated",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.report
      .update({
        where: { id: report.id },
        data: { processingError: message.slice(0, 1000) },
      })
      .catch(() => {
        // ignore — we're already in the failure path
      });
    logger.error(
      { reportId: report.id, err: message },
      "report-generate failed",
    );
    throw err;
  }
}
