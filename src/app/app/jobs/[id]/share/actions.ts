"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { sendMail } from "@/lib/mailer";
import { env } from "@/lib/env";

const createInput = z.object({
  jobId: z.string().min(1),
  recipientEmail: z.string().email(),
  message: z.string().trim().max(2000).optional(),
  expiresInDays: z.number().int().min(1).max(60).default(7),
  scopes: z
    .object({
      photos: z.boolean().default(false),
      readings: z.boolean().default(false),
      dryingLogs: z.boolean().default(false),
      equipment: z.boolean().default(false),
      reportIds: z.array(z.string()).default([]),
    })
    .default({
      photos: false,
      readings: false,
      dryingLogs: false,
      equipment: false,
      reportIds: [],
    }),
});

export interface CreateJobShareResult {
  ok: boolean;
  shareUrl?: string;
  message?: string;
}

async function loadJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      assignments: { select: { userId: true } },
      customer: true,
      organization: { select: { name: true, reportFooter: true } },
    },
  });
  if (!job) throw new Error("Job not found");
  return job;
}

/**
 * Create a job-scope JobShare with the chosen scopes/reports and email
 * the recipient a /share/<token> link.
 */
export async function createJobShare(
  input: z.infer<typeof createInput>,
): Promise<CreateJobShareResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };
  const data = createInput.parse(input);

  const job = await loadJob(data.jobId);
  assertCan(actor, "report.generate", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const anyScope =
    data.scopes.photos ||
    data.scopes.readings ||
    data.scopes.dryingLogs ||
    data.scopes.equipment ||
    data.scopes.reportIds.length > 0;
  if (!anyScope) {
    return {
      ok: false,
      message: "Pick at least one item to include in the share.",
    };
  }

  const expiresAt = new Date(
    Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000,
  );
  const token = randomBytes(32).toString("hex");

  const share = await prisma.jobShare.create({
    data: {
      jobId: job.id,
      recipientEmail: data.recipientEmail,
      token,
      expiresAt,
      permissions: {
        kind: "job",
        scopes: data.scopes,
        message: data.message,
      },
    },
  });

  const shareUrl = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/share/${token}`;

  await sendMail({
    to: data.recipientEmail,
    subject: `Job ${job.jobNumber} — restoration documentation`,
    text: [
      data.message ? `${data.message}\n\n` : "",
      `${job.organization.name} has shared restoration documentation with you.\n\n`,
      `Job: ${job.jobNumber}\n`,
      `Property: ${job.customer.firstName} ${job.customer.lastName} — ${job.customer.addressLine1}, ${job.customer.city} ${job.customer.state}\n\n`,
      `Open the link (expires ${expiresAt.toLocaleDateString("en-US")}):\n${shareUrl}\n`,
      job.organization.reportFooter ? `\n${job.organization.reportFooter}` : "",
    ].join(""),
  });

  await recordAudit(
    "share.create",
    { actor: { userId: actor.id }, jobId: job.id },
    {
      shareId: share.id,
      recipientEmail: data.recipientEmail,
      scopes: data.scopes,
      expiresAt: expiresAt.toISOString(),
    },
  );

  revalidatePath(`/app/jobs/${data.jobId}/share`);
  return { ok: true, shareUrl };
}

const revokeInput = z.object({ shareId: z.string().min(1) });

export async function revokeShare(input: z.infer<typeof revokeInput>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const { shareId } = revokeInput.parse(input);

  const share = await prisma.jobShare.findUnique({
    where: { id: shareId },
    include: {
      job: {
        select: {
          id: true,
          organizationId: true,
          createdById: true,
          assignments: { select: { userId: true } },
        },
      },
    },
  });
  if (!share) return;

  assertCan(actor, "report.generate", {
    id: share.job.id,
    organizationId: share.job.organizationId,
    assignedUserIds: share.job.assignments.map((a) => a.userId),
    createdById: share.job.createdById,
  });

  await prisma.jobShare.update({
    where: { id: shareId },
    data: { revoked: true },
  });

  await recordAudit(
    "share.revoke",
    { actor: { userId: actor.id }, jobId: share.jobId },
    { shareId },
  );

  revalidatePath(`/app/jobs/${share.jobId}/share`);
}

const extendInput = z.object({
  shareId: z.string().min(1),
  extraDays: z.number().int().min(1).max(60),
});

export async function extendShare(input: z.infer<typeof extendInput>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const { shareId, extraDays } = extendInput.parse(input);

  const share = await prisma.jobShare.findUnique({
    where: { id: shareId },
    include: {
      job: {
        select: {
          id: true,
          organizationId: true,
          createdById: true,
          assignments: { select: { userId: true } },
        },
      },
    },
  });
  if (!share) return;

  assertCan(actor, "report.generate", {
    id: share.job.id,
    organizationId: share.job.organizationId,
    assignedUserIds: share.job.assignments.map((a) => a.userId),
    createdById: share.job.createdById,
  });

  // Extend from whichever is later: now or current expiry. Revoked
  // shares re-arm, which is intentional — a revoked link can be
  // re-issued without minting a new token.
  const base =
    share.expiresAt.getTime() > Date.now() ? share.expiresAt : new Date();
  const newExpiry = new Date(base.getTime() + extraDays * 24 * 60 * 60 * 1000);

  await prisma.jobShare.update({
    where: { id: shareId },
    data: { expiresAt: newExpiry, revoked: false },
  });

  await recordAudit(
    "share.extend",
    { actor: { userId: actor.id }, jobId: share.jobId },
    { shareId, newExpiry: newExpiry.toISOString() },
  );

  revalidatePath(`/app/jobs/${share.jobId}/share`);
}
