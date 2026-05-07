"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EquipmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

async function loadJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      organizationId: true,
      assignments: { select: { userId: true } },
      createdById: true,
    },
  });
  if (!job) throw new Error("Job not found");
  return job;
}

const placeSchema = z.object({
  jobId: z.string().min(1),
  equipmentId: z.string().min(1),
  roomId: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function placeEquipmentOnJob(input: z.infer<typeof placeSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = placeSchema.parse(input);

  const job = await loadJob(data.jobId);
  assertCan(actor, "job.update", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const eq = await prisma.equipment.findUnique({
    where: { id: data.equipmentId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      assetTag: true,
      placements: { where: { removedAt: null }, select: { id: true, jobId: true } },
    },
  });
  if (!eq || eq.organizationId !== actor.organizationId) {
    throw new Error("Equipment not found");
  }
  if (eq.status === EquipmentStatus.RETIRED) {
    throw new Error("This unit is retired.");
  }
  if (eq.placements.length > 0) {
    throw new Error("This unit is already deployed on another job.");
  }

  if (data.roomId) {
    const room = await prisma.room.findUnique({
      where: { id: data.roomId },
      select: { jobId: true },
    });
    if (!room || room.jobId !== data.jobId) {
      throw new Error("Room doesn't belong to this job");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.equipmentPlacement.create({
      data: {
        jobId: data.jobId,
        equipmentId: eq.id,
        roomId: data.roomId ?? null,
        notes: data.notes ?? null,
      },
    });
    await tx.equipment.update({
      where: { id: eq.id },
      data: { status: EquipmentStatus.DEPLOYED },
    });
  });

  await recordAudit(
    "equipment.place",
    { actor: { userId: actor.id }, jobId: data.jobId },
    { equipmentId: eq.id, assetTag: eq.assetTag, roomId: data.roomId ?? null },
  );

  revalidatePath(`/app/jobs/${data.jobId}/equipment`);
  revalidatePath("/app/equipment");
}

const removeSchema = z.object({
  jobId: z.string().min(1),
  placementId: z.string().min(1),
});

export async function removePlacement(input: z.infer<typeof removeSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = removeSchema.parse(input);

  const job = await loadJob(data.jobId);
  assertCan(actor, "job.update", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const placement = await prisma.equipmentPlacement.findUnique({
    where: { id: data.placementId },
    select: {
      id: true,
      jobId: true,
      removedAt: true,
      equipmentId: true,
      equipment: { select: { id: true, assetTag: true, organizationId: true } },
    },
  });
  if (!placement || placement.jobId !== data.jobId) {
    throw new Error("Placement not found");
  }
  if (
    placement.equipment.organizationId !== job.organizationId
  ) {
    throw new Error("Placement / equipment org mismatch");
  }
  if (placement.removedAt) {
    return; // already removed — idempotent
  }

  await prisma.$transaction(async (tx) => {
    await tx.equipmentPlacement.update({
      where: { id: placement.id },
      data: { removedAt: new Date() },
    });
    // Only flip back to AVAILABLE if no other open placement on this unit.
    const otherOpen = await tx.equipmentPlacement.count({
      where: { equipmentId: placement.equipmentId, removedAt: null },
    });
    if (otherOpen === 0) {
      await tx.equipment.update({
        where: { id: placement.equipmentId },
        data: { status: EquipmentStatus.AVAILABLE },
      });
    }
  });

  await recordAudit(
    "equipment.remove",
    { actor: { userId: actor.id }, jobId: data.jobId },
    { placementId: placement.id, assetTag: placement.equipment.assetTag },
  );

  revalidatePath(`/app/jobs/${data.jobId}/equipment`);
  revalidatePath("/app/equipment");
}
