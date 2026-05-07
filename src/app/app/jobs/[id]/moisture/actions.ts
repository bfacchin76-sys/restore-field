"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Material, MeterType, ScaleType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

async function loadJobForReading(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      organizationId: true,
      status: true,
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

const readingSchema = z.object({
  roomId: z.string().nullable().optional(),
  surface: z.string().trim().min(1, "Surface is required").max(120),
  material: z.nativeEnum(Material),
  meterType: z.nativeEnum(MeterType).default(MeterType.PIN),
  scaleType: z.nativeEnum(ScaleType).default(ScaleType.PERCENT_MC),
  moistureValue: z.coerce.number().refine((n) => Number.isFinite(n), {
    message: "Enter a numeric reading",
  }),
  ambientTempF: optionalNum,
  ambientRH: optionalNum,
  isDryGoal: z.coerce.boolean().optional().default(false),
  isInitial: z.coerce.boolean().optional().default(false),
  notes: z.string().trim().max(500).nullable().optional(),
});

export interface ReadingActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Surface used — handy for echoing back into a "next reading" prefill. */
  surface?: string;
  roomId?: string | null;
}

const initial: ReadingActionResult = { ok: false };

function flatten(err: import("zod").ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const k = issue.path.join(".") || "_form";
    if (!out[k]) out[k] = issue.message;
  }
  return out;
}

function readForm(formData: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    // Treat empty strings as undefined for the optional preprocessors.
    o[k] = v === "" ? undefined : v;
  }
  return o;
}

async function ensureGoalNotDuplicated(
  jobId: string,
  roomId: string | null,
  surface: string,
  isDryGoal: boolean,
): Promise<void> {
  if (!isDryGoal) return;
  const existing = await prisma.moistureReading.findFirst({
    where: {
      jobId,
      roomId: roomId ?? null,
      surface,
      isDryGoal: true,
    },
    select: { id: true },
  });
  if (existing) {
    // Demote the previous goal — only one goal per surface.
    await prisma.moistureReading.update({
      where: { id: existing.id },
      data: { isDryGoal: false },
    });
  }
}

/**
 * Create a single reading. Auto-flags `isDry` if a goal is on file
 * and the reading is at-or-below it. Auto-creates today's drying-log
 * row if none exists yet (PRD §8.4).
 */
export async function createReading(
  _prev: ReadingActionResult,
  formData: FormData,
): Promise<ReadingActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return { ok: false, message: "Missing jobId" };
  const job = await loadJobForReading(jobId);
  assertCan(actor, "reading.create", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const parsed = readingSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: flatten(parsed.error) };
  }
  const d = parsed.data;
  const roomId = d.roomId && d.roomId.length > 0 ? d.roomId : null;
  if (roomId) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { jobId: true },
    });
    if (!room || room.jobId !== jobId) {
      return { ok: false, message: "Room doesn't belong to this job" };
    }
  }

  await ensureGoalNotDuplicated(jobId, roomId, d.surface, d.isDryGoal);

  const goal = await prisma.moistureReading.findFirst({
    where: { jobId, roomId, surface: d.surface, isDryGoal: true },
    select: { moistureValue: true },
  });
  const isDry = goal != null && d.moistureValue <= goal.moistureValue;

  await prisma.$transaction(async (tx) => {
    await tx.moistureReading.create({
      data: {
        jobId,
        roomId,
        surface: d.surface,
        material: d.material,
        meterType: d.meterType,
        scaleType: d.scaleType,
        moistureValue: d.moistureValue,
        ambientTempF: d.ambientTempF ?? null,
        ambientRH: d.ambientRH ?? null,
        isDryGoal: d.isDryGoal,
        isInitial: d.isInitial,
        isDry,
        notes: d.notes && d.notes.length > 0 ? d.notes : null,
        takenById: actor.id,
      },
    });

    // Auto-promote DRAFT → ACTIVE on first reading (PRD §8.1).
    if (job.status === "DRAFT") {
      await tx.job.update({
        where: { id: jobId },
        data: { status: "ACTIVE", firstResponseAt: new Date() },
      });
    }

    // Auto-create today's drying log if none.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const existing = await tx.dryingLog.findFirst({
      where: { jobId, logDate: { gte: today, lt: tomorrow } },
      select: { id: true },
    });
    if (!existing) {
      await tx.dryingLog.create({
        data: { jobId, logDate: today, recordedById: actor.id },
      });
    }
  });

  await recordAudit(
    "reading.create",
    { actor: { userId: actor.id }, jobId },
    {
      surface: d.surface,
      moistureValue: d.moistureValue,
      isDryGoal: d.isDryGoal,
    },
  );

  revalidatePath(`/app/jobs/${jobId}/moisture`);
  revalidatePath(`/app/jobs/${jobId}/drying`);
  return {
    ok: true,
    message: "Saved.",
    surface: d.surface,
    roomId,
  };
}

const bulkSchema = z.object({
  jobId: z.string().min(1),
  roomId: z.string().nullable().optional(),
  surface: z.string().trim().min(1).max(120),
  material: z.nativeEnum(Material),
  meterType: z.nativeEnum(MeterType).default(MeterType.PIN),
  scaleType: z.nativeEnum(ScaleType).default(ScaleType.PERCENT_MC),
  ambientTempF: z.number().nullable().optional(),
  ambientRH: z.number().nullable().optional(),
  values: z
    .array(z.number().refine((n) => Number.isFinite(n)))
    .min(1)
    .max(50),
});

/**
 * Bulk reading entry: same surface, multiple values. PRD §8.4.
 * "I'm taking 8 readings on the kitchen drywall" — reuse surface,
 * just enter values rapidly.
 */
export async function bulkCreateReadings(input: z.infer<typeof bulkSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = bulkSchema.parse(input);

  const job = await loadJobForReading(data.jobId);
  assertCan(actor, "reading.create", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const roomId = data.roomId && data.roomId.length > 0 ? data.roomId : null;

  const goal = await prisma.moistureReading.findFirst({
    where: { jobId: data.jobId, roomId, surface: data.surface, isDryGoal: true },
    select: { moistureValue: true },
  });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < data.values.length; i++) {
      const v = data.values[i];
      const isDry = goal != null && v <= goal.moistureValue;
      await tx.moistureReading.create({
        data: {
          jobId: data.jobId,
          roomId,
          surface: data.surface,
          material: data.material,
          meterType: data.meterType,
          scaleType: data.scaleType,
          moistureValue: v,
          ambientTempF: data.ambientTempF ?? null,
          ambientRH: data.ambientRH ?? null,
          isDry,
          takenById: actor.id,
          // Stagger by milliseconds so the chart shows them in order.
          takenAt: new Date(now.getTime() + i),
        },
      });
    }
    if (job.status === "DRAFT") {
      await tx.job.update({
        where: { id: data.jobId },
        data: { status: "ACTIVE", firstResponseAt: new Date() },
      });
    }
  });

  await recordAudit(
    "reading.bulk",
    { actor: { userId: actor.id }, jobId: data.jobId },
    { surface: data.surface, count: data.values.length },
  );

  revalidatePath(`/app/jobs/${data.jobId}/moisture`);
}

const updateSchema = z.object({
  readingId: z.string().min(1),
  moistureValue: z.number().optional(),
  notes: z.string().nullable().optional(),
  isDryGoal: z.boolean().optional(),
});

export async function updateReading(input: z.infer<typeof updateSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = updateSchema.parse(input);

  const reading = await prisma.moistureReading.findUnique({
    where: { id: data.readingId },
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
  if (!reading) throw new Error("Reading not found");

  assertCan(actor, "reading.create", {
    id: reading.job.id,
    organizationId: reading.job.organizationId,
    assignedUserIds: reading.job.assignments.map((a) => a.userId),
    createdById: reading.job.createdById,
  });

  if (data.isDryGoal === true) {
    await ensureGoalNotDuplicated(
      reading.jobId,
      reading.roomId,
      reading.surface,
      true,
    );
  }

  await prisma.moistureReading.update({
    where: { id: data.readingId },
    data: {
      moistureValue: data.moistureValue,
      notes: data.notes,
      isDryGoal: data.isDryGoal,
    },
  });

  await recordAudit(
    "reading.update",
    { actor: { userId: actor.id }, jobId: reading.jobId },
    { readingId: data.readingId },
  );

  revalidatePath(`/app/jobs/${reading.jobId}/moisture`);
}

const deleteSchema = z.object({ readingId: z.string().min(1) });

export async function deleteReading(input: z.infer<typeof deleteSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = deleteSchema.parse(input);

  const reading = await prisma.moistureReading.findUnique({
    where: { id: data.readingId },
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
  if (!reading) return;

  assertCan(actor, "reading.create", {
    id: reading.job.id,
    organizationId: reading.job.organizationId,
    assignedUserIds: reading.job.assignments.map((a) => a.userId),
    createdById: reading.job.createdById,
  });

  await prisma.moistureReading.delete({ where: { id: data.readingId } });

  await recordAudit(
    "reading.delete",
    { actor: { userId: actor.id }, jobId: reading.jobId },
    { readingId: data.readingId },
  );

  revalidatePath(`/app/jobs/${reading.jobId}/moisture`);
}

void initial; // re-export-friendly
