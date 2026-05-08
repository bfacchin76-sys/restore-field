import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

interface SharePermissions {
  kind?: "report" | "job";
  scopes?: { photos?: boolean };
}

/**
 * Photo bytes for a job-scope share. Always streams the EXIF-stripped
 * medium WebP — never the original (PRD §8.2: "Stripped on derivatives
 * by default" for shared copies). If the medium derivative isn't ready
 * yet (image-process queue still working), 425 Too Early so the
 * recipient retries instead of getting EXIF/GPS leak.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await ctx.params;

  const share = await prisma.jobShare.findUnique({
    where: { token },
    include: { job: { select: { organizationId: true } } },
  });
  if (!share || share.revoked || share.expiresAt.getTime() < Date.now()) {
    return new NextResponse("Link expired or revoked.", { status: 410 });
  }

  const perms = (share.permissions ?? {}) as SharePermissions;
  if (!perms.scopes?.photos) {
    return new NextResponse("Photos not included in this share.", { status: 403 });
  }

  const photo = await prisma.photo.findUnique({
    where: { id },
    include: { job: { select: { organizationId: true } } },
  });
  // Audit M5: defense-in-depth — confirm both jobId AND organizationId
  // agree, so even a future bug that re-points a Job across orgs can't
  // exfil photos through a stale share.
  if (
    !photo ||
    photo.jobId !== share.jobId ||
    photo.job.organizationId !== share.job.organizationId
  ) {
    return new NextResponse("Not found.", { status: 404 });
  }
  if (!photo.mediumKey) {
    return new NextResponse(
      "Photo still processing. Try again in a moment.",
      { status: 425 },
    );
  }

  const storage = getStorage();
  const bytes = await storage.getObjectBytes(photo.mediumKey);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=300",
    },
  });
}
