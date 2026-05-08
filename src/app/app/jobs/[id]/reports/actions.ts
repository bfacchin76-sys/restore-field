"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ReportType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { randomBytes } from "node:crypto";
import { collectReportSnapshot } from "@/lib/reports/data-snapshot";
import { getReportGenerateQueue } from "@/lib/queue/queues";
import { sendMail } from "@/lib/mailer";
import { env } from "@/lib/env";
import type { ReportConfig } from "@/lib/reports/types";

const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  code: z.string().trim().max(40).nullish(),
  quantity: z.number().finite().min(0),
  unit: z.string().trim().min(1).max(10),
  unitPrice: z.number().finite().min(0),
});

const configSchema = z
  .object({
    includePhotos: z.boolean().optional(),
    includeReadings: z.boolean().optional(),
    includeDryingLogs: z.boolean().optional(),
    includeEquipment: z.boolean().optional(),
    includeForms: z.boolean().optional(),
    includeSignatures: z.boolean().optional(),
    scopeSummary: z.string().trim().max(2000).optional(),
    estimate: z
      .object({
        overheadProfitRate: z.number().finite().min(0).max(1),
        salesTaxRate: z.number().finite().min(0).max(1),
        paymentTerms: z.string().trim().max(500).optional(),
        lines: z.array(lineItemSchema).min(1).max(200),
      })
      .optional(),
  })
  .default({});

const generateInput = z.object({
  jobId: z.string().min(1),
  reportType: z.nativeEnum(ReportType),
  config: configSchema,
});

export interface GenerateReportResult {
  ok: boolean;
  reportId?: string;
  message?: string;
}

async function loadJobForReport(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      organizationId: true,
      createdById: true,
      assignments: { select: { userId: true } },
    },
  });
  if (!job) throw new Error("Job not found");
  return job;
}

/**
 * Create a Report row, collect the snapshot synchronously, then enqueue
 * the PDF render. The Report.pdfStorageKey is set to a placeholder ("")
 * until the worker stamps the final key.
 */
export async function generateReport(
  input: z.infer<typeof generateInput>,
): Promise<GenerateReportResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };
  const data = generateInput.parse(input);

  const job = await loadJobForReport(data.jobId);
  assertCan(actor, "report.generate", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const config: ReportConfig = data.config;

  // Collect the snapshot now so the JSON is stable even if the queue
  // processes the job hours later (offline / Redis hiccup).
  const snapshot = await collectReportSnapshot({
    jobId: data.jobId,
    reportType: data.reportType,
    config,
  });

  const report = await prisma.report.create({
    data: {
      jobId: data.jobId,
      type: data.reportType,
      // pdfStorageKey stays NULL until the worker stamps it. Audit M4.
      pdfStorageKey: null,
      // Prisma's Json type accepts our serialisable snapshot directly.
      dataSnapshot: snapshot as unknown as object,
      config: (config ?? {}) as unknown as object,
      generatedById: actor.id,
    },
  });

  await getReportGenerateQueue().add(
    "report",
    { reportId: report.id },
    { jobId: report.id },
  );

  await recordAudit(
    "report.generate",
    { actor: { userId: actor.id }, jobId: data.jobId },
    { reportId: report.id, type: data.reportType },
  );

  revalidatePath(`/app/jobs/${data.jobId}/reports`);
  return { ok: true, reportId: report.id };
}

const regenerateInput = z.object({ reportId: z.string().min(1) });

/** Re-collect snapshot + re-enqueue the PDF render. */
export async function regenerateReport(
  input: z.infer<typeof regenerateInput>,
): Promise<GenerateReportResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };
  const { reportId } = regenerateInput.parse(input);

  const existing = await prisma.report.findUnique({
    where: { id: reportId },
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
  if (!existing) return { ok: false, message: "Report not found" };

  assertCan(actor, "report.generate", {
    id: existing.job.id,
    organizationId: existing.job.organizationId,
    assignedUserIds: existing.job.assignments.map((a) => a.userId),
    createdById: existing.job.createdById,
  });

  const config = (existing.config ?? {}) as ReportConfig;
  const snapshot = await collectReportSnapshot({
    jobId: existing.jobId,
    reportType: existing.type,
    config,
  });

  await prisma.report.update({
    where: { id: reportId },
    data: {
      dataSnapshot: snapshot as unknown as object,
      pdfStorageKey: null,
      processingError: null,
      processingAttempts: 0,
      generatedAt: new Date(),
      generatedById: actor.id,
    },
  });

  await getReportGenerateQueue().add(
    "report",
    { reportId },
    { jobId: `${reportId}-${Date.now()}` },
  );

  await recordAudit(
    "report.regenerate",
    { actor: { userId: actor.id }, jobId: existing.jobId },
    { reportId },
  );

  revalidatePath(`/app/jobs/${existing.jobId}/reports`);
  return { ok: true, reportId };
}

const deleteInput = z.object({ reportId: z.string().min(1) });

export async function deleteReport(input: z.infer<typeof deleteInput>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const { reportId } = deleteInput.parse(input);

  const report = await prisma.report.findUnique({
    where: { id: reportId },
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
  if (!report) return;

  // Owners/Admins can delete any; the original generator can also delete
  // their own report.
  if (report.generatedById !== actor.id) {
    assertCan(actor, "user.manage", { id: report.job.organizationId });
  } else {
    assertCan(actor, "report.generate", {
      id: report.job.id,
      organizationId: report.job.organizationId,
      assignedUserIds: report.job.assignments.map((a) => a.userId),
      createdById: report.job.createdById,
    });
  }

  await prisma.report.delete({ where: { id: reportId } });

  await recordAudit(
    "report.delete",
    { actor: { userId: actor.id }, jobId: report.jobId },
    { reportId, type: report.type },
  );

  revalidatePath(`/app/jobs/${report.jobId}/reports`);
}

const emailInput = z.object({
  reportId: z.string().min(1),
  recipientEmail: z.string().email(),
  message: z.string().trim().max(2000).optional(),
  /** Days the public-share link stays valid. PRD §10 default 7 days. */
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export interface EmailReportResult {
  ok: boolean;
  message?: string;
  shareUrl?: string;
}

/**
 * Email the report to an external party (typically the adjuster). Issues
 * a `JobShare` row with a single-purpose token gating /share/[token]
 * (which streams just this report's PDF). The recipient does NOT need
 * an account.
 */
export async function emailReport(
  input: z.infer<typeof emailInput>,
): Promise<EmailReportResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };
  const data = emailInput.parse(input);

  const report = await prisma.report.findUnique({
    where: { id: data.reportId },
    include: {
      job: {
        include: {
          customer: true,
          organization: { select: { name: true, reportFooter: true } },
          assignments: { select: { userId: true } },
        },
      },
    },
  });
  if (!report) return { ok: false, message: "Report not found" };

  assertCan(actor, "report.generate", {
    id: report.job.id,
    organizationId: report.job.organizationId,
    assignedUserIds: report.job.assignments.map((a) => a.userId),
    createdById: report.job.createdById,
  });

  if (!report.pdfStorageKey) {
    return {
      ok: false,
      message: "PDF still generating — try again in a few seconds.",
    };
  }

  const expiresAt = new Date(
    Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000,
  );
  // PRD §10: time-limited public share. JobShare.token is the bearer
  // credential — random 32-byte hex, only stored here (not hashed,
  // because that's what the shared URL itself contains).
  const token = randomBytes(32).toString("hex");

  const share = await prisma.jobShare.create({
    data: {
      jobId: report.jobId,
      recipientEmail: data.recipientEmail,
      token,
      expiresAt,
      permissions: { reportId: data.reportId },
    },
  });

  const shareUrl = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/share/${token}`;

  await sendMail({
    to: data.recipientEmail,
    subject: `Restoration report — Job ${report.job.jobNumber}`,
    text: [
      data.message ? `${data.message}\n\n` : "",
      `${report.job.organization.name} has shared a restoration report with you.\n\n`,
      `Job: ${report.job.jobNumber}\n`,
      `Property: ${report.job.customer.firstName} ${report.job.customer.lastName} — ${report.job.customer.addressLine1}, ${report.job.customer.city} ${report.job.customer.state}\n\n`,
      `View the PDF here (link expires ${expiresAt.toLocaleDateString("en-US")}):\n${shareUrl}\n`,
      report.job.organization.reportFooter
        ? `\n${report.job.organization.reportFooter}`
        : "",
    ].join(""),
  });

  await recordAudit(
    "report.email",
    { actor: { userId: actor.id }, jobId: report.jobId },
    { reportId: data.reportId, recipientEmail: data.recipientEmail, shareId: share.id },
  );

  revalidatePath(`/app/jobs/${report.jobId}/reports`);
  return { ok: true, shareUrl };
}
