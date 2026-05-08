import "server-only";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { renderReportPdf } from "@/lib/reports/render";
import { logger } from "@/lib/logger";
import type { ReportSnapshot } from "@/lib/reports/types";
import type { ReportGenerateJob } from "../queues";

/**
 * Worker pipeline for the report-generate queue:
 *   1. Load the Report row (snapshot already populated by the Server Action).
 *   2. Render snapshot → letter PDF.
 *   3. Upload to storage at reports/{orgId}/{jobId}/{reportId}.pdf.
 *   4. Stamp the Report row with the final pdfStorageKey.
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

  const snapshot = report.dataSnapshot as unknown as ReportSnapshot;
  const pdf = await renderReportPdf(snapshot);

  const orgId = report.job.organizationId;
  const finalKey = `reports/${orgId}/${report.jobId}/${report.id}.pdf`;

  const storage = getStorage();
  await storage.putObjectBytes(finalKey, pdf, "application/pdf");

  await prisma.report.update({
    where: { id: report.id },
    data: { pdfStorageKey: finalKey },
  });

  logger.info(
    { reportId: report.id, sizeBytes: pdf.length, type: report.type },
    "report generated",
  );
}
