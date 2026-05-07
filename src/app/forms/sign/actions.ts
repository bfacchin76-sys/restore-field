"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { FormStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { findUsableToken, markTokenUsed } from "@/lib/auth/tokens";
import { recordAudit } from "@/lib/audit";
import { getStorage } from "@/lib/storage";
import {
  formSchemaSchema,
  formValuesSchema,
  validateValues,
} from "@/lib/forms/templates";
import { renderSignedFormPdf } from "@/lib/forms/pdf";
import { logger } from "@/lib/logger";

export interface SignActionResult {
  ok: boolean;
  message?: string;
}

const signSchema = z.object({
  token: z.string().min(10),
  signerName: z.string().trim().min(1).max(120),
  signerEmail: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  /** JSON-encoded values map; signature data URLs included. */
  valuesJson: z.string().min(2),
});

/**
 * Public-route action — no auth. Consumes a FORM_SIGN token, validates
 * signature + required field values, renders the signed PDF, uploads to
 * storage, and stamps the FormSubmission COMPLETED.
 *
 * Idempotent if called twice with the same (already used) token: the
 * second call returns ok=false with a clear message.
 */
export async function submitSignedForm(
  _prev: SignActionResult,
  formData: FormData,
): Promise<SignActionResult> {
  const parsed = signSchema.safeParse({
    token: formData.get("token"),
    signerName: formData.get("signerName"),
    signerEmail: formData.get("signerEmail"),
    valuesJson: formData.get("valuesJson"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const data = parsed.data;

  const tokenRow = await findUsableToken(data.token, "FORM_SIGN");
  if (!tokenRow) {
    return { ok: false, message: "This signing link is invalid or has expired." };
  }
  const payload = (tokenRow.payload ?? {}) as { submissionId?: string };
  if (!payload.submissionId) {
    return { ok: false, message: "This signing link is malformed." };
  }

  let valuesParsed: unknown;
  try {
    valuesParsed = JSON.parse(data.valuesJson);
  } catch {
    return { ok: false, message: "Form values are not valid JSON." };
  }
  const valuesResult = formValuesSchema.safeParse(valuesParsed);
  if (!valuesResult.success) {
    return { ok: false, message: "Form values failed validation." };
  }
  const values = valuesResult.data;

  const submission = await prisma.formSubmission.findUnique({
    where: { id: payload.submissionId },
    include: {
      template: true,
      job: {
        include: {
          customer: true,
          organization: {
            select: { name: true, primaryColor: true, reportFooter: true },
          },
        },
      },
    },
  });
  if (!submission) return { ok: false, message: "Submission not found" };
  if (submission.status === FormStatus.COMPLETED) {
    return {
      ok: false,
      message: "This form was already signed. Re-open it from your records if you need a copy.",
    };
  }

  const schemaResult = formSchemaSchema.safeParse(submission.template.schema);
  if (!schemaResult.success) {
    logger.error({ submissionId: submission.id }, "form template schema invalid");
    return { ok: false, message: "Template is corrupt — contact the sender." };
  }

  const schema = schemaResult.data;
  const validation = validateValues(schema, values);
  if (!validation.ok) {
    return {
      ok: false,
      message: `Missing required field${validation.missing.length === 1 ? "" : "s"}: ${validation.missing.join(", ")}`,
    };
  }

  // Capture audit metadata.
  let ipAddress: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ipAddress =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null;
    userAgent = h.get("user-agent");
  } catch {
    /* outside request — fine */
  }

  // Persist signatures (one per signature field). For v1 there's typically
  // a single customer signature; the schema supports more.
  const signatureRows: Array<{
    signerName: string;
    signerEmail: string | null;
    signerRole: string;
    signedAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    signatureDataUrl: string;
  }> = [];

  await prisma.$transaction(async (tx) => {
    for (const f of schema.fields) {
      if (f.type !== "signature") continue;
      const v = values[f.id];
      if (typeof v !== "string" || !v.startsWith("data:image/")) continue;
      await tx.signature.create({
        data: {
          formSubmissionId: submission.id,
          signerName: data.signerName,
          signerEmail: data.signerEmail || tokenRow.email,
          signerRole: f.label.toLowerCase().includes("tech") ? "Technician" : "Customer",
          signatureDataUrl: v,
          ipAddress,
          userAgent,
        },
      });
      signatureRows.push({
        signerName: data.signerName,
        signerEmail: data.signerEmail || tokenRow.email,
        signerRole: f.label.toLowerCase().includes("tech") ? "Technician" : "Customer",
        signedAt: new Date(),
        ipAddress,
        userAgent,
        signatureDataUrl: v,
      });
    }
    await tx.formSubmission.update({
      where: { id: submission.id },
      data: {
        values: values as object,
        status: FormStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
  });

  await markTokenUsed(tokenRow.id);

  // Render PDF + upload to storage. Best-effort — don't fail the sign
  // action if the renderer hiccups; the submission is already COMPLETED
  // and admins can re-trigger the render later.
  try {
    const pdf = await renderSignedFormPdf({
      templateName: submission.template.name,
      bodyTemplate: submission.template.bodyTemplate,
      schema,
      values,
      context: {
        job: {
          jobNumber: submission.job.jobNumber,
          lossDate: submission.job.lossDate ?? null,
          causeOfLoss: submission.job.causeOfLoss,
          scopeNotes: submission.job.scopeNotes,
        },
        customer: submission.job.customer,
        org: submission.job.organization,
        completionDate: typeof values.completionDate === "string" ? values.completionDate : undefined,
      },
      signatures: signatureRows,
    });
    const storage = getStorage();
    const key = `orgs/${submission.job.organizationId}/jobs/${submission.jobId}/forms/${submission.id}.pdf`;
    await storage.putObjectBytes(key, pdf, "application/pdf");
    await prisma.formSubmission.update({
      where: { id: submission.id },
      data: { renderedPdfKey: key },
    });
  } catch (err) {
    logger.error(
      { err, submissionId: submission.id },
      "form PDF render failed (submission still marked COMPLETED)",
    );
  }

  await recordAudit(
    "form.signed",
    { actor: null, jobId: submission.jobId },
    {
      submissionId: submission.id,
      templateName: submission.template.name,
      signerName: data.signerName,
      signerEmail: data.signerEmail || tokenRow.email,
    },
  );

  revalidatePath(`/app/jobs/${submission.jobId}/forms`);
  return { ok: true, message: "Thank you — your signature was recorded." };
}
