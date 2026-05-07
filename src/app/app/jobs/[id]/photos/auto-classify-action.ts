"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { classifyByTags } from "@/lib/photos/salvageability";

const input = z.object({ jobId: z.string().min(1) });

/**
 * Runs the rules-based classifier against every photo on this job that
 * doesn't already have a salvageability rating. Restricted to FIRE jobs
 * per PRD §8.2.
 */
export async function autoClassifyFirePhotos(
  raw: z.infer<typeof input>,
): Promise<{ ok: boolean; updated: number; message?: string }> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, updated: 0, message: "Not signed in" };
  const { jobId } = input.parse(raw);

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      organizationId: true,
      lossType: true,
      createdById: true,
      assignments: { select: { userId: true } },
    },
  });
  if (!job) return { ok: false, updated: 0, message: "Job not found" };

  assertCan(actor, "photo.upload", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  if (job.lossType !== "FIRE") {
    return {
      ok: false,
      updated: 0,
      message: "Auto-classify is only available for FIRE jobs.",
    };
  }

  const photos = await prisma.photo.findMany({
    where: { jobId, salvageability: null },
    select: { id: true, tags: true, caption: true },
  });

  let updated = 0;
  for (const p of photos) {
    const verdict = classifyByTags(p.tags, p.caption);
    if (!verdict) continue;
    await prisma.photo.update({
      where: { id: p.id },
      data: { salvageability: verdict },
    });
    updated++;
  }

  await recordAudit(
    "photo.auto_classify",
    { actor: { userId: actor.id }, jobId },
    { considered: photos.length, updated },
  );

  revalidatePath(`/app/jobs/${jobId}/photos`);
  return { ok: true, updated };
}
