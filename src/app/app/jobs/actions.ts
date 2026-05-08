"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { JobStatus, LossType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { generateJobNumber } from "@/lib/business/job-number";
import { assertCanTransition } from "@/lib/business/job-status";
import { notifyJobStatusChange } from "@/lib/notifications/dispatch";

export interface JobActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  jobId?: string;
}

const createJobSchema = z.object({
  customerId: z.string().min(1, "Pick a customer"),
  lossType: z.nativeEnum(LossType),
  lossDate: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? new Date(v) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), {
      message: "Invalid date",
    }),
  causeOfLoss: z.string().trim().optional().or(z.literal("")),
  scopeNotes: z.string().trim().optional().or(z.literal("")),
});

export async function createJob(
  _prev: JobActionResult,
  formData: FormData,
): Promise<JobActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  assertCan(actor, "job.create", { id: actor.organizationId });

  const parsed = createJobSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path.join(".") || "_form";
      if (!fe[k]) fe[k] = issue.message;
    }
    return { ok: false, fieldErrors: fe };
  }

  // Validate customer belongs to this org
  const customer = await prisma.customer.findUnique({
    where: { id: parsed.data.customerId },
    select: { organizationId: true },
  });
  if (!customer || customer.organizationId !== actor.organizationId) {
    return { ok: false, fieldErrors: { customerId: "Customer not found" } };
  }

  const job = await prisma.$transaction(async (tx) => {
    const jobNumber = await generateJobNumber(actor.organizationId, tx);
    return tx.job.create({
      data: {
        jobNumber,
        organizationId: actor.organizationId,
        customerId: parsed.data.customerId,
        lossType: parsed.data.lossType,
        status: JobStatus.DRAFT,
        lossDate: parsed.data.lossDate,
        causeOfLoss: parsed.data.causeOfLoss?.trim() || null,
        scopeNotes: parsed.data.scopeNotes?.trim() || null,
        createdById: actor.id,
        // Auto-assign the creator as a "lead"
        assignments: {
          create: { userId: actor.id, role: "lead" },
        },
      },
    });
  });

  await recordAudit(
    "job.create",
    { actor: { userId: actor.id }, jobId: job.id },
    {
      jobNumber: job.jobNumber,
      customerId: job.customerId,
      lossType: job.lossType,
    },
  );

  revalidatePath("/app/jobs");
  revalidatePath(`/app/customers/${job.customerId}`);
  redirect(`/app/jobs/${job.id}`);
}

const overviewSchema = z.object({
  causeOfLoss: z.string().trim().optional().or(z.literal("")),
  scopeNotes: z.string().trim().optional().or(z.literal("")),
  lossDate: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? new Date(v) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), {
      message: "Invalid date",
    }),
});

export async function updateJobOverview(
  jobId: string,
  _prev: JobActionResult,
  formData: FormData,
): Promise<JobActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      organizationId: true,
      assignments: { select: { userId: true } },
      createdById: true,
    },
  });
  if (!job) return { ok: false, message: "Job not found" };

  assertCan(actor, "job.update", {
    id: jobId,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const parsed = overviewSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check inputs",
    };
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      causeOfLoss: parsed.data.causeOfLoss?.trim() || null,
      scopeNotes: parsed.data.scopeNotes?.trim() || null,
      lossDate: parsed.data.lossDate,
    },
  });

  await recordAudit(
    "job.update",
    { actor: { userId: actor.id }, jobId },
    { fields: ["causeOfLoss", "scopeNotes", "lossDate"] },
  );

  revalidatePath(`/app/jobs/${jobId}`);
  return { ok: true, message: "Saved." };
}

export interface StatusActionResult {
  ok: boolean;
  message?: string;
}

export async function transitionJobStatus(
  jobId: string,
  _prev: StatusActionResult,
  formData: FormData,
): Promise<StatusActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      organizationId: true,
      status: true,
      jobNumber: true,
      assignments: { select: { userId: true } },
      createdById: true,
    },
  });
  if (!job) return { ok: false, message: "Job not found" };

  assertCan(actor, "job.update", {
    id: jobId,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const to = String(formData.get("to") ?? "") as JobStatus;
  if (!Object.values(JobStatus).includes(to)) {
    return { ok: false, message: "Unknown status" };
  }

  try {
    assertCanTransition(job.status, to);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Cannot transition",
    };
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: to,
      firstResponseAt:
        job.status === JobStatus.DRAFT && to === JobStatus.ACTIVE
          ? new Date()
          : undefined,
      closedAt: to === JobStatus.CLOSED ? new Date() : undefined,
    },
  });

  await recordAudit(
    "job.status.update",
    { actor: { userId: actor.id }, jobId },
    { from: job.status, to, jobNumber: job.jobNumber },
  );

  // Best-effort fan-out — won't block the action if SMTP is down.
  await notifyJobStatusChange({
    jobId,
    fromStatus: job.status,
    toStatus: to,
    changedById: actor.id,
  });

  revalidatePath(`/app/jobs/${jobId}`);
  revalidatePath("/app/jobs");
  return { ok: true, message: `Status updated to ${to.replace("_", " ").toLowerCase()}.` };
}
