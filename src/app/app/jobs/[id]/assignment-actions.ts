"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

const addSchema = z.object({
  jobId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["lead", "tech", "estimator", "subcontractor"]).default("tech"),
});

const removeSchema = z.object({
  jobId: z.string().min(1),
  userId: z.string().min(1),
});

export async function addAssignment(input: z.infer<typeof addSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = addSchema.parse(input);

  const job = await prisma.job.findUnique({
    where: { id: data.jobId },
    select: {
      organizationId: true,
      assignments: { select: { userId: true } },
      createdById: true,
    },
  });
  if (!job) throw new Error("Job not found");

  assertCan(actor, "job.update", {
    id: data.jobId,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  // Validate target user is in the same org
  const target = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { organizationId: true, name: true, active: true },
  });
  if (
    !target ||
    target.organizationId !== actor.organizationId ||
    !target.active
  ) {
    throw new Error("User not assignable");
  }

  await prisma.jobAssignment.upsert({
    where: { jobId_userId: { jobId: data.jobId, userId: data.userId } },
    create: { jobId: data.jobId, userId: data.userId, role: data.role },
    update: { role: data.role },
  });

  await recordAudit(
    "job.assignment.add",
    { actor: { userId: actor.id }, jobId: data.jobId },
    { targetUserId: data.userId, role: data.role, targetName: target.name },
  );

  revalidatePath(`/app/jobs/${data.jobId}`);
}

export async function removeAssignment(input: z.infer<typeof removeSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = removeSchema.parse(input);

  const job = await prisma.job.findUnique({
    where: { id: data.jobId },
    select: {
      organizationId: true,
      assignments: { select: { userId: true } },
      createdById: true,
    },
  });
  if (!job) throw new Error("Job not found");

  assertCan(actor, "job.update", {
    id: data.jobId,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  await prisma.jobAssignment
    .delete({
      where: { jobId_userId: { jobId: data.jobId, userId: data.userId } },
    })
    .catch(() => {
      /* already removed — fine */
    });

  await recordAudit(
    "job.assignment.remove",
    { actor: { userId: actor.id }, jobId: data.jobId },
    { targetUserId: data.userId },
  );

  revalidatePath(`/app/jobs/${data.jobId}`);
}
