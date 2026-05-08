import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import { getStorage } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Auth-gated PDF download for a generated Report.
 *
 * GET /api/reports/:id/pdf — streams the stored PDF from object storage.
 *   - 401 when not signed in.
 *   - 403 when the actor can't view the underlying job.
 *   - 404 when the report doesn't exist.
 *   - 425 (Too Early) when the worker hasn't stamped pdfStorageKey yet.
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          organizationId: true,
          createdById: true,
          assignments: { select: { userId: true } },
        },
      },
    },
  });
  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowed = can(
    {
      id: session.user.id,
      role: session.user.role,
      organizationId: session.user.organizationId,
      active: session.user.active,
    },
    "job.view",
    {
      id: report.job.id,
      organizationId: report.job.organizationId,
      assignedUserIds: report.job.assignments.map((a) => a.userId),
      createdById: report.job.createdById,
    },
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!report.pdfStorageKey) {
    return NextResponse.json(
      { error: "PDF still generating — try again in a moment." },
      { status: 425 },
    );
  }

  const storage = getStorage();
  const bytes = await storage.getObjectBytes(report.pdfStorageKey);

  await recordAudit(
    "report.download",
    { actor: { userId: session.user.id }, jobId: report.jobId },
    { reportId: report.id, type: report.type },
  );

  const safeName = `${report.job.jobNumber}-${report.type}.pdf`.replace(
    /[^a-z0-9._-]/gi,
    "_",
  );
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, max-age=0",
    },
  });
}
