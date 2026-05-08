"use server";

import { revalidatePath } from "next/cache";
import { JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { generateJobNumber } from "@/lib/business/job-number";
import {
  parseEncircleCsv,
  type ParsedEncircleRow,
} from "@/lib/import/encircle-csv";

export interface ImportResult {
  ok: boolean;
  parsed: number;
  customersCreated: number;
  customersReused: number;
  jobsCreated: number;
  errors: Array<{ line: number; message: string }>;
  message?: string;
}

/**
 * Parse + import an Encircle CSV. Owner-only. Strategy:
 *   - Each row is a customer + job pair.
 *   - Customers are deduped by (lastName + addressLine1) within the
 *     org — Encircle exports usually have one row per loss event so
 *     repeats == returning customer at the same address.
 *   - Jobs are always created fresh (Encircle has its own ids; we
 *     don't try to reconcile with prior FieldRestore imports).
 *   - The whole import runs in a single transaction so a partial
 *     failure rolls back. The job-number generator uses its own row
 *     locks so concurrent imports stay atomic.
 */
export async function importEncircleCsv(
  csv: string,
): Promise<ImportResult> {
  const actor = await getSessionUser();
  if (!actor)
    return {
      ok: false,
      parsed: 0,
      customersCreated: 0,
      customersReused: 0,
      jobsCreated: 0,
      errors: [],
      message: "Not signed in",
    };

  assertCan(actor, "org.settings", { id: actor.organizationId });

  const parsed = parseEncircleCsv(csv);
  if (parsed.rows.length === 0) {
    return {
      ok: false,
      parsed: 0,
      customersCreated: 0,
      customersReused: 0,
      jobsCreated: 0,
      errors: parsed.errors,
      message: "No importable rows.",
    };
  }

  let customersCreated = 0;
  let customersReused = 0;
  let jobsCreated = 0;

  // Pre-fetch all candidate customers for dedupe.
  await prisma.$transaction(
    async (tx) => {
      // Per-row sequential because the job-number generator needs the
      // counter table to settle. With ~100 rows the latency is fine.
      for (const row of parsed.rows) {
        const customer = await upsertCustomer(tx, actor.organizationId, row);
        if (customer.created) customersCreated++;
        else customersReused++;

        const jobNumber = await generateJobNumber(actor.organizationId, tx);
        await tx.job.create({
          data: {
            jobNumber,
            organizationId: actor.organizationId,
            customerId: customer.id,
            lossType: row.lossType,
            status: JobStatus.CLOSED, // historical imports are closed by default
            lossDate: row.lossDate,
            closedAt: row.lossDate ?? new Date(),
            causeOfLoss: row.causeOfLoss,
            scopeNotes: row.scopeNotes,
            createdById: actor.id,
          },
        });
        jobsCreated++;
      }
    },
    { timeout: 120_000 },
  );

  await recordAudit(
    "import.encircle",
    { actor: { userId: actor.id } },
    {
      parsed: parsed.rows.length,
      customersCreated,
      customersReused,
      jobsCreated,
      errors: parsed.errors.length,
    },
  );

  revalidatePath("/app/admin/import");
  revalidatePath("/app/jobs");

  return {
    ok: true,
    parsed: parsed.rows.length,
    customersCreated,
    customersReused,
    jobsCreated,
    errors: parsed.errors,
  };
}

async function upsertCustomer(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  organizationId: string,
  row: ParsedEncircleRow,
): Promise<{ id: string; created: boolean }> {
  // Dedupe within the organisation by (lastName, addressLine1) — close
  // enough for Encircle exports without a strict natural key.
  const existing = await tx.customer.findFirst({
    where: {
      organizationId,
      lastName: { equals: row.customerLastName, mode: "insensitive" },
      addressLine1: { equals: row.addressLine1, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await tx.customer.create({
    data: {
      organizationId,
      firstName: row.customerFirstName,
      lastName: row.customerLastName,
      email: row.customerEmail,
      phone: row.customerPhone,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      insuranceCarrier: row.insuranceCarrier,
      policyNumber: row.policyNumber,
      claimNumber: row.claimNumber,
      adjusterName: row.adjusterName,
      adjusterEmail: row.adjusterEmail,
      adjusterPhone: row.adjusterPhone,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}
