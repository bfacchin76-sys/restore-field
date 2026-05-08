import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

interface SharePermissions {
  kind?: "report" | "job";
  reportId?: string;
  scopes?: { reportIds?: string[] };
}

/**
 * Streams a specific report PDF on a job-scope share. Verifies the
 * report id is in the share's `permissions.scopes.reportIds` allow-list
 * (or, for legacy single-report shares, equals `permissions.reportId`).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await ctx.params;

  const share = await prisma.jobShare.findUnique({
    where: { token },
    include: {
      job: { select: { jobNumber: true, organizationId: true } },
    },
  });
  if (!share || share.revoked || share.expiresAt.getTime() < Date.now()) {
    return new NextResponse("Link expired or revoked.", { status: 410 });
  }

  const perms = (share.permissions ?? {}) as SharePermissions;
  const allowedIds = new Set<string>();
  if (perms.reportId) allowedIds.add(perms.reportId);
  for (const r of perms.scopes?.reportIds ?? []) allowedIds.add(r);
  if (!allowedIds.has(id)) {
    return new NextResponse("Report not included in this share.", { status: 403 });
  }

  const report = await prisma.report.findUnique({
    where: { id },
    include: { job: { select: { organizationId: true } } },
  });
  // Audit M5: confirm both jobId and organizationId match.
  if (
    !report ||
    report.jobId !== share.jobId ||
    report.job.organizationId !== share.job.organizationId
  ) {
    return new NextResponse("Not found.", { status: 404 });
  }
  if (!report.pdfStorageKey) {
    return new NextResponse("Report still generating.", { status: 425 });
  }

  const storage = getStorage();
  const bytes = await storage.getObjectBytes(report.pdfStorageKey);

  await recordAudit(
    "report.share.access",
    { actor: null, jobId: share.jobId },
    { reportId: report.id, shareId: share.id },
  );

  const safeName = `${share.job.jobNumber}-${report.type}.pdf`.replace(
    /[^a-z0-9._-]/gi,
    "_",
  );
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
