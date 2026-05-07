"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { gppRounded } from "@/lib/business/psychrometrics";

async function loadJobForReading(jobId: string) {
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

const optionalNum = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}, z.number().nullable().optional());

const dryingSchema = z.object({
  jobId: z.string().min(1),
  /** ISO date (yyyy-mm-dd) — represents a calendar day in UTC. */
  logDate: z.string().refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), {
    message: "Use yyyy-mm-dd",
  }),
  outsideTempF: optionalNum,
  outsideRH: optionalNum,
  outsideGPP: optionalNum,
  unaffectedTempF: optionalNum,
  unaffectedRH: optionalNum,
  unaffectedGPP: optionalNum,
  affectedTempF: optionalNum,
  affectedRH: optionalNum,
  affectedGPP: optionalNum,
  hvacTempF: optionalNum,
  hvacRH: optionalNum,
  hvacGPP: optionalNum,
  techNotes: z.string().nullable().optional(),
});

export interface DryingActionResult {
  ok: boolean;
  message?: string;
}

function readForm(formData: FormData) {
  const o: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    o[k] = v === "" ? undefined : v;
  }
  return o;
}

/**
 * Compute GPP from temp + RH if the user only supplied two of three
 * columns. Doesn't override an explicitly entered GPP.
 */
function fillGpp(
  tempF: number | null | undefined,
  rh: number | null | undefined,
  current: number | null | undefined,
): number | null {
  if (current != null && Number.isFinite(current)) return current;
  if (tempF == null || rh == null) return null;
  if (!Number.isFinite(tempF) || !Number.isFinite(rh)) return null;
  return gppRounded(tempF, rh);
}

/**
 * Upsert today's (or any date's) drying log. PRD §8.4.
 *
 * Auto-fills GPP for any quadrant where temp + RH are present but GPP is
 * blank. Doesn't overwrite a hand-entered GPP value.
 */
export async function upsertDryingLog(
  _prev: DryingActionResult,
  formData: FormData,
): Promise<DryingActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  const parsed = dryingSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check inputs",
    };
  }
  const d = parsed.data;
  const job = await loadJobForReading(d.jobId);
  assertCan(actor, "reading.create", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const logDate = new Date(`${d.logDate}T00:00:00.000Z`);
  if (Number.isNaN(logDate.getTime())) {
    return { ok: false, message: "Invalid date" };
  }

  const data = {
    outsideTempF: d.outsideTempF ?? null,
    outsideRH: d.outsideRH ?? null,
    outsideGPP: fillGpp(d.outsideTempF, d.outsideRH, d.outsideGPP),
    unaffectedTempF: d.unaffectedTempF ?? null,
    unaffectedRH: d.unaffectedRH ?? null,
    unaffectedGPP: fillGpp(d.unaffectedTempF, d.unaffectedRH, d.unaffectedGPP),
    affectedTempF: d.affectedTempF ?? null,
    affectedRH: d.affectedRH ?? null,
    affectedGPP: fillGpp(d.affectedTempF, d.affectedRH, d.affectedGPP),
    hvacTempF: d.hvacTempF ?? null,
    hvacRH: d.hvacRH ?? null,
    hvacGPP: fillGpp(d.hvacTempF, d.hvacRH, d.hvacGPP),
    techNotes: d.techNotes ?? null,
  };

  // One row per (jobId, logDate). No DB unique constraint — find-then-update.
  const existing = await prisma.dryingLog.findFirst({
    where: {
      jobId: d.jobId,
      logDate,
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.dryingLog.update({ where: { id: existing.id }, data });
  } else {
    await prisma.dryingLog.create({
      data: { jobId: d.jobId, logDate, recordedById: actor.id, ...data },
    });
  }

  await recordAudit(
    "drying.upsert",
    { actor: { userId: actor.id }, jobId: d.jobId },
    { logDate: d.logDate },
  );

  revalidatePath(`/app/jobs/${d.jobId}/drying`);
  return { ok: true, message: "Saved." };
}
