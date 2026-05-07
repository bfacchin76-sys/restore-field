import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import { getStorage } from "@/lib/storage";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Auth-gated PDF download for a signed FormSubmission.
 *
 * GET /api/forms/:id/pdf — streams the rendered PDF from object storage.
 * 404 when the submission isn't on a job the actor can view, or when the
 * PDF hasn't been rendered yet.
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

  const submission = await prisma.formSubmission.findUnique({
    where: { id },
    include: {
      template: { select: { name: true } },
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
  if (!submission) {
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
      id: submission.job.id,
      organizationId: submission.job.organizationId,
      assignedUserIds: submission.job.assignments.map((a) => a.userId),
      createdById: submission.job.createdById,
    },
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!submission.renderedPdfKey) {
    return NextResponse.json(
      { error: "PDF not yet rendered. Try again in a moment." },
      { status: 404 },
    );
  }

  const storage = getStorage();
  const bytes = await storage.getObjectBytes(submission.renderedPdfKey);

  await recordAudit(
    "form.pdf.download",
    { actor: { userId: session.user.id }, jobId: submission.jobId },
    { submissionId: submission.id },
  );

  const safeName = `${submission.job.jobNumber}-${submission.template.name}.pdf`.replace(
    /[^a-z0-9._-]/gi,
    "_",
  );
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, max-age=0",
    },
  });
}
