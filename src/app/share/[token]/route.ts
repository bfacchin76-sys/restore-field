import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Public share endpoint. Adjusters / customers receive an email with
 * `/share/<token>` — no account needed.
 *
 * Validates the JobShare row (token unique, not revoked, not expired,
 * permissions blob references a real Report on the same job), stamps
 * lastUsedAt, audits the access, then streams the report PDF.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const share = await prisma.jobShare.findUnique({
    where: { token },
    include: {
      job: { select: { id: true, jobNumber: true } },
    },
  });

  if (!share || share.revoked || share.expiresAt.getTime() < Date.now()) {
    return new NextResponse("Link expired or revoked.", { status: 410 });
  }

  const perms = (share.permissions ?? {}) as { reportId?: string };
  if (!perms.reportId) {
    return new NextResponse("Share is not a report link.", { status: 400 });
  }

  const report = await prisma.report.findUnique({
    where: { id: perms.reportId },
  });
  if (!report || report.jobId !== share.jobId) {
    return new NextResponse("Not found.", { status: 404 });
  }
  if (!report.pdfStorageKey) {
    return new NextResponse("Report still generating. Try again shortly.", {
      status: 425,
    });
  }

  await prisma.jobShare.update({
    where: { id: share.id },
    data: { lastUsedAt: new Date() },
  });

  const storage = getStorage();
  const bytes = await storage.getObjectBytes(report.pdfStorageKey);

  await recordAudit(
    "report.share.access",
    { actor: null, jobId: share.jobId },
    { reportId: report.id, shareId: share.id, recipientEmail: share.recipientEmail },
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
