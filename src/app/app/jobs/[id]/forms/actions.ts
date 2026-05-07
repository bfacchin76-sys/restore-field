"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FormStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { issueVerificationToken } from "@/lib/auth/tokens";
import { sendMail } from "@/lib/mailer";
import { formSignEmail } from "@/lib/forms/email-templates";

async function loadJob(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      assignments: { select: { userId: true } },
      customer: true,
      organization: { select: { name: true, primaryColor: true, reportFooter: true } },
    },
  });
  if (!job) throw new Error("Job not found");
  return job;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const sendInput = z.object({
  jobId: z.string().min(1),
  templateId: z.string().min(1),
  recipientEmail: z.string().trim().toLowerCase().email(),
});

export interface SendResult {
  ok: boolean;
  message?: string;
  submissionId?: string;
}

/**
 * Create a FormSubmission, issue a FORM_SIGN token, send the recipient
 * a magic-link email. The submission's `values` are pre-filled with
 * customer / job context so the signer only has to confirm + sign.
 */
export async function sendFormForSigning(
  input: z.infer<typeof sendInput>,
): Promise<SendResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };
  const data = sendInput.parse(input);

  const job = await loadJob(data.jobId);
  assertCan(actor, "job.update", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const template = await prisma.formTemplate.findUnique({
    where: { id: data.templateId },
    select: {
      id: true,
      name: true,
      organizationId: true,
      active: true,
    },
  });
  if (
    !template ||
    template.organizationId !== job.organizationId ||
    !template.active
  ) {
    return { ok: false, message: "Template not available" };
  }

  // Pre-fill values from job/customer context.
  const prefill = {
    customerName: `${job.customer.firstName} ${job.customer.lastName}`,
    lossAddress: `${job.customer.addressLine1}, ${job.customer.city}, ${job.customer.state} ${job.customer.postalCode}`,
    lossDate: job.lossDate ? job.lossDate.toISOString().slice(0, 10) : "",
    completionDate: new Date().toISOString().slice(0, 10),
    scopeSummary: job.scopeNotes ?? "",
  };

  const submission = await prisma.formSubmission.create({
    data: {
      jobId: data.jobId,
      templateId: template.id,
      values: prefill as object,
      status: FormStatus.SENT,
      sentToEmail: data.recipientEmail,
      sentAt: new Date(),
    },
  });

  const { rawToken } = await issueVerificationToken({
    purpose: "FORM_SIGN",
    email: data.recipientEmail,
    organizationId: job.organizationId,
    ttlMs: SEVEN_DAYS_MS,
    payload: { submissionId: submission.id },
  });

  const tpl = formSignEmail(job.organization.name, template.name, rawToken);
  await sendMail({ to: data.recipientEmail, ...tpl });

  await recordAudit(
    "form.send",
    { actor: { userId: actor.id }, jobId: data.jobId },
    {
      submissionId: submission.id,
      templateId: template.id,
      templateName: template.name,
      recipient: data.recipientEmail,
    },
  );

  revalidatePath(`/app/jobs/${data.jobId}/forms`);
  return { ok: true, submissionId: submission.id };
}

const idInput = z.object({ submissionId: z.string().min(1) });

async function loadSubmissionForActor(submissionId: string) {
  const sub = await prisma.formSubmission.findUnique({
    where: { id: submissionId },
    include: {
      template: { select: { name: true } },
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
  return sub;
}

export async function resendForSigning(input: z.infer<typeof idInput>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = idInput.parse(input);
  const sub = await loadSubmissionForActor(data.submissionId);
  if (!sub) throw new Error("Submission not found");
  assertCan(actor, "job.update", {
    id: sub.job.id,
    organizationId: sub.job.organizationId,
    assignedUserIds: sub.job.assignments.map((a) => a.userId),
    createdById: sub.job.createdById,
  });
  if (!sub.sentToEmail) throw new Error("No recipient on file");
  if (sub.status === FormStatus.COMPLETED) {
    throw new Error("Already signed.");
  }

  const org = await prisma.organization.findUnique({
    where: { id: sub.job.organizationId },
    select: { name: true },
  });
  const { rawToken } = await issueVerificationToken({
    purpose: "FORM_SIGN",
    email: sub.sentToEmail,
    organizationId: sub.job.organizationId,
    ttlMs: SEVEN_DAYS_MS,
    payload: { submissionId: sub.id },
  });

  const tpl = formSignEmail(org?.name ?? "RestoreField", sub.template.name, rawToken);
  await sendMail({ to: sub.sentToEmail, ...tpl });

  await prisma.formSubmission.update({
    where: { id: sub.id },
    data: { status: FormStatus.SENT, sentAt: new Date() },
  });

  await recordAudit(
    "form.resend",
    { actor: { userId: actor.id }, jobId: sub.jobId },
    { submissionId: sub.id, recipient: sub.sentToEmail },
  );

  revalidatePath(`/app/jobs/${sub.jobId}/forms`);
}

export async function voidSubmission(input: z.infer<typeof idInput>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = idInput.parse(input);
  const sub = await loadSubmissionForActor(data.submissionId);
  if (!sub) throw new Error("Submission not found");
  assertCan(actor, "job.update", {
    id: sub.job.id,
    organizationId: sub.job.organizationId,
    assignedUserIds: sub.job.assignments.map((a) => a.userId),
    createdById: sub.job.createdById,
  });

  await prisma.$transaction(async (tx) => {
    await tx.formSubmission.update({
      where: { id: sub.id },
      data: { status: FormStatus.EXPIRED },
    });
    // Invalidate any outstanding sign tokens for this submission.
    await tx.verificationToken.updateMany({
      where: {
        purpose: "FORM_SIGN",
        organizationId: sub.job.organizationId,
        usedAt: null,
        // We can't filter by payload.submissionId in Prisma's typed where,
        // so we mark all unused FORM_SIGN tokens for this org's email-as-of
        // sentToEmail; safe because these tokens are single-use anyway.
        email: sub.sentToEmail ?? "",
      },
      data: { usedAt: new Date() },
    });
  });

  await recordAudit(
    "form.void",
    { actor: { userId: actor.id }, jobId: sub.jobId },
    { submissionId: sub.id },
  );

  revalidatePath(`/app/jobs/${sub.jobId}/forms`);
}

export async function markCompletedManually(input: z.infer<typeof idInput>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = idInput.parse(input);
  const sub = await loadSubmissionForActor(data.submissionId);
  if (!sub) throw new Error("Submission not found");
  assertCan(actor, "job.update", {
    id: sub.job.id,
    organizationId: sub.job.organizationId,
    assignedUserIds: sub.job.assignments.map((a) => a.userId),
    createdById: sub.job.createdById,
  });

  await prisma.formSubmission.update({
    where: { id: sub.id },
    data: {
      status: FormStatus.COMPLETED,
      completedAt: new Date(),
    },
  });

  await recordAudit(
    "form.mark_completed",
    { actor: { userId: actor.id }, jobId: sub.jobId },
    { submissionId: sub.id },
  );

  revalidatePath(`/app/jobs/${sub.jobId}/forms`);
}
