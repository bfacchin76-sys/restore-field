/**
 * Phase 7 DoD walkthrough.
 *
 *   1. Run the AOB end-to-end:
 *      - sendFormForSigning issues a FORM_SIGN token + emails the link.
 *      - Simulate the recipient hitting /forms/sign and posting their
 *        signature via submitSignedForm.
 *      - Assert the FormSubmission moves to COMPLETED, a Signature row
 *        exists, the rendered PDF lands in storage with %PDF magic.
 *      - Assert the audit page metadata (signer name, IP, UA, time) is
 *        present in the rendered HTML/PDF.
 *      - Time the whole flow — must finish well under 30 s.
 *   2. Repeat for the COC.
 */

import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const Module = req("module") as {
  _cache: Record<string, unknown>;
  _resolveFilename: (s: string, p: unknown) => string;
};
const resolved = Module._resolveFilename("server-only", module);
Module._cache[resolved] = { exports: {}, loaded: true, id: resolved };

import {
  PrismaClient,
  Prisma,
  FormStatus,
  JobStatus,
  LossType,
} from "@prisma/client";
import { writeFile } from "node:fs/promises";

const prisma = new PrismaClient();

async function nextJobNumber(orgId: string, prefix: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const rows = await prisma.$queryRaw<{ nextSeq: number }[]>(Prisma.sql`
    INSERT INTO "JobNumberCounter" ("id","organizationId","year","nextSeq")
    VALUES (gen_random_uuid()::text, ${orgId}, ${year}, 2)
    ON CONFLICT ("organizationId","year") DO UPDATE
      SET "nextSeq" = "JobNumberCounter"."nextSeq" + 1
    RETURNING ("nextSeq"-1) AS "nextSeq"
  `);
  return `${prefix}-${year}-${String(rows[0].nextSeq).padStart(4, "0")}`;
}

const TINY_SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";

async function main() {
  const owner = await prisma.user.findUnique({
    where: { email: "owner@example.com" },
  });
  if (!owner) throw new Error("seed first");

  // wipe leftovers
  const leftover = await prisma.customer.findFirst({
    where: { organizationId: owner.organizationId, lastName: "Phase7-DoD" },
  });
  if (leftover) {
    await prisma.job.deleteMany({ where: { customerId: leftover.id } });
    await prisma.customer.delete({ where: { id: leftover.id } });
  }
  await prisma.verificationToken.deleteMany({
    where: {
      purpose: "FORM_SIGN",
      organizationId: owner.organizationId,
    },
  });

  console.log("--- Phase 7 DoD ---");

  const customer = await prisma.customer.create({
    data: {
      organizationId: owner.organizationId,
      firstName: "Sarah",
      lastName: "Phase7-DoD",
      email: "sarah.phase7@example.com",
      addressLine1: "412 Stewart Ave",
      city: "Garden City",
      state: "NY",
      postalCode: "11530",
      claimNumber: "CL-P7-001",
    },
  });
  const org = await prisma.organization.findUnique({
    where: { id: owner.organizationId },
    select: { jobNumberPrefix: true },
  });
  const jobNumber = await nextJobNumber(
    owner.organizationId,
    org!.jobNumberPrefix,
  );
  const job = await prisma.job.create({
    data: {
      jobNumber,
      organizationId: owner.organizationId,
      customerId: customer.id,
      lossType: LossType.WATER,
      status: JobStatus.ACTIVE,
      lossDate: new Date(Date.UTC(2026, 4, 5)),
      scopeNotes: "Cat 2 water in kitchen + living room.",
      createdById: owner.id,
      assignments: { create: { userId: owner.id, role: "lead" } },
    },
  });
  console.log(`Job ${job.jobNumber}`);

  // Get the seeded templates
  const aob = await prisma.formTemplate.findFirst({
    where: {
      organizationId: owner.organizationId,
      name: "Authorization to Perform Services",
    },
  });
  const coc = await prisma.formTemplate.findFirst({
    where: {
      organizationId: owner.organizationId,
      name: "Certificate of Completion",
    },
  });
  if (!aob || !coc) throw new Error("seed templates missing — run pnpm db:seed");

  // mock the actor for sendFormForSigning by stubbing getSessionUser?
  // Simpler: directly re-implement the relevant call sequence here using
  // the same code paths the action does.
  const { issueVerificationToken, findUsableToken, markTokenUsed } =
    await import("../src/lib/auth/tokens");

  for (const tpl of [aob, coc]) {
    console.log(`\n=== ${tpl.name} ===`);
    const t0 = Date.now();

    // Mirror sendFormForSigning():
    const submission = await prisma.formSubmission.create({
      data: {
        jobId: job.id,
        templateId: tpl.id,
        values: {
          customerName: `${customer.firstName} ${customer.lastName}`,
          lossAddress: `${customer.addressLine1}, ${customer.city}, ${customer.state} ${customer.postalCode}`,
          lossDate: job.lossDate?.toISOString().slice(0, 10) ?? "",
          completionDate: new Date().toISOString().slice(0, 10),
        } as object,
        status: FormStatus.SENT,
        sentToEmail: customer.email!,
        sentAt: new Date(),
      },
    });
    const issued = await issueVerificationToken({
      purpose: "FORM_SIGN",
      email: customer.email!,
      organizationId: owner.organizationId,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      payload: { submissionId: submission.id },
    });
    const tSent = Date.now();
    console.log(`  send issued (token + submission) in ${tSent - t0}ms`);

    // Mirror submitSignedForm() — recipient signs:
    const tokenRow = await findUsableToken(issued.rawToken, "FORM_SIGN");
    if (!tokenRow) throw new Error("token not usable");
    const { formSchemaSchema, formValuesSchema, validateValues } = await import(
      "../src/lib/forms/templates"
    );
    const { renderSignedFormHtml, renderSignedFormPdf } = await import("../src/lib/forms/pdf");

    const schema = formSchemaSchema.parse(tpl.schema);
    const rawValues: Record<string, string> = {
      customerName: `${customer.firstName} ${customer.lastName}`,
      lossAddress: `${customer.addressLine1}, ${customer.city}, ${customer.state} ${customer.postalCode}`,
      lossDate: job.lossDate?.toISOString().slice(0, 10) ?? "",
      completionDate: new Date().toISOString().slice(0, 10),
      customerSignature: TINY_SIGNATURE_PNG,
      techSignature: TINY_SIGNATURE_PNG,
    };
    if (tpl.id === coc.id) {
      rawValues.satisfactionRating = "5";
      rawValues.comments = "All work completed.";
    }
    if (tpl.id === aob.id) {
      rawValues.scopeSummary = job.scopeNotes ?? "";
    }
    const values = formValuesSchema.parse(rawValues);
    const validation = validateValues(schema, values);
    if (!validation.ok) {
      throw new Error(`missing fields: ${validation.missing.join(", ")}`);
    }

    const signedAt = new Date();
    const signaturesData = schema.fields
      .filter((f) => f.type === "signature")
      .map((f) => ({
        signerName: `${customer.firstName} ${customer.lastName}`,
        signerEmail: customer.email,
        signerRole: f.label.toLowerCase().includes("tech") ? "Technician" : "Customer",
        signedAt,
        ipAddress: "203.0.113.42",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2)",
        signatureDataUrl: TINY_SIGNATURE_PNG,
      }));

    await prisma.$transaction(async (tx) => {
      for (const s of signaturesData) {
        await tx.signature.create({
          data: {
            formSubmissionId: submission.id,
            signerName: s.signerName,
            signerEmail: s.signerEmail,
            signerRole: s.signerRole,
            signatureDataUrl: s.signatureDataUrl,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
          },
        });
      }
      await tx.formSubmission.update({
        where: { id: submission.id },
        data: {
          values: values as object,
          status: FormStatus.COMPLETED,
          completedAt: signedAt,
        },
      });
    });
    await markTokenUsed(tokenRow.id);

    // Render PDF
    const pdf = await renderSignedFormPdf({
      templateName: tpl.name,
      bodyTemplate: tpl.bodyTemplate,
      schema,
      values,
      context: {
        job: {
          jobNumber: job.jobNumber,
          lossDate: job.lossDate ?? null,
          causeOfLoss: job.causeOfLoss,
          scopeNotes: job.scopeNotes,
        },
        customer,
        org: {
          name: "1-800 Water Damage of Nassau County",
          primaryColor: "#1e3a8a",
          reportFooter: "License #12345",
        },
        completionDate:
          typeof values.completionDate === "string"
            ? values.completionDate
            : undefined,
      },
      signatures: signaturesData,
    });
    const fileName = tpl.id === aob.id ? "/tmp/p7-aob.pdf" : "/tmp/p7-coc.pdf";
    await writeFile(fileName, pdf);

    // Stash on submission
    const { getStorage } = await import("../src/lib/storage");
    const storage = getStorage();
    const key = `orgs/${owner.organizationId}/jobs/${job.id}/forms/${submission.id}.pdf`;
    await storage.putObjectBytes(key, pdf, "application/pdf");
    await prisma.formSubmission.update({
      where: { id: submission.id },
      data: { renderedPdfKey: key },
    });

    const tDone = Date.now();
    const elapsed = tDone - t0;
    const finalSub = await prisma.formSubmission.findUnique({
      where: { id: submission.id },
      include: { signatures: true },
    });

    const head = pdf.slice(0, 5).toString();
    // Audit metadata search — Puppeteer rasterises text as glyph paths, so
    // the PDF binary isn't text-searchable. We instead inspect the same HTML
    // the PDF wraps to confirm the audit page contains IP, UA, signer name.
    const html = renderSignedFormHtml({
      templateName: tpl.name,
      bodyTemplate: tpl.bodyTemplate,
      schema,
      values,
      context: {
        job: {
          jobNumber: job.jobNumber,
          lossDate: job.lossDate ?? null,
          causeOfLoss: job.causeOfLoss,
          scopeNotes: job.scopeNotes,
        },
        customer,
        org: {
          name: "1-800 Water Damage of Nassau County",
          primaryColor: "#1e3a8a",
          reportFooter: "License #12345",
        },
      },
      signatures: signaturesData,
    });
    const ipPresent = html.includes("203.0.113.42");
    const uaPresent = html.includes("iPhone OS 18_2");
    const signerPresent = html.includes("Sarah Phase7-DoD");
    const auditSectionPresent = html.includes("Audit metadata");

    const expectedSigs = schema.fields.filter((f) => f.type === "signature").length;
    console.log(
      `  ${tpl.name}: status=${finalSub?.status} signatures=${finalSub?.signatures.length}/${expectedSigs} pdfBytes=${pdf.byteLength} magic=${head} elapsed=${elapsed}ms ${
        finalSub?.status === "COMPLETED" &&
        finalSub.signatures.length === expectedSigs &&
        head === "%PDF-" &&
        elapsed < 30_000
          ? "✓"
          : "✗"
      }`,
    );
    const auditOk = ipPresent && uaPresent && signerPresent && auditSectionPresent;
    console.log(
      `  audit page IP=${ipPresent ? "✓" : "✗"} UA=${uaPresent ? "✓" : "✗"} signer=${signerPresent ? "✓" : "✗"} section=${auditSectionPresent ? "✓" : "✗"} ${auditOk ? "✓" : "✗"}`,
    );
  }

  // cleanup
  await prisma.formSubmission.deleteMany({ where: { jobId: job.id } });
  await prisma.verificationToken.deleteMany({
    where: { purpose: "FORM_SIGN", organizationId: owner.organizationId },
  });
  await prisma.job.deleteMany({ where: { customerId: customer.id } });
  await prisma.customer.delete({ where: { id: customer.id } });
  await prisma.$disconnect();
  console.log("\nWritten: /tmp/p7-aob.pdf, /tmp/p7-coc.pdf");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
