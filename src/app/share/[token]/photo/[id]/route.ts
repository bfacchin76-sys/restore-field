import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

interface SharePermissions {
  kind?: "report" | "job";
  scopes?: { photos?: boolean };
}

/**
 * Photo bytes for a job-scope share. Streams the medium WebP if
 * available, else the original. The share must:
 *   - have `kind: "job"` (or omit kind but include scopes.photos),
 *   - not be revoked or expired,
 *   - and the photo must belong to the same job as the share.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await ctx.params;

  const share = await prisma.jobShare.findUnique({ where: { token } });
  if (!share || share.revoked || share.expiresAt.getTime() < Date.now()) {
    return new NextResponse("Link expired or revoked.", { status: 410 });
  }

  const perms = (share.permissions ?? {}) as SharePermissions;
  if (!perms.scopes?.photos) {
    return new NextResponse("Photos not included in this share.", { status: 403 });
  }

  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo || photo.jobId !== share.jobId) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const storage = getStorage();
  const key = photo.mediumKey ?? photo.storageKey;
  const bytes = await storage.getObjectBytes(key);
  const mime = photo.mediumKey ? "image/webp" : photo.mimeType;

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=300",
    },
  });
}
