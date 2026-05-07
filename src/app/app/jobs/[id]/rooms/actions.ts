"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WaterCategory, WaterClass } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { isAffectedMaterial } from "@/lib/business/affected-materials";

async function loadJobForEdit(jobId: string) {
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

const roomSchema = z.object({
  name: z.string().trim().min(1, "Room name is required"),
  floor: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length ? v : null)),
  lengthFt: optionalNum,
  widthFt: optionalNum,
  heightFt: optionalNum,
  category: z
    .union([z.literal(""), z.nativeEnum(WaterCategory)])
    .optional()
    .transform((v) => (v && v.length ? (v as WaterCategory) : null)),
  classOfLoss: z
    .union([z.literal(""), z.nativeEnum(WaterClass)])
    .optional()
    .transform((v) => (v && v.length ? (v as WaterClass) : null)),
  notes: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length ? v : null)),
});

export interface RoomActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

function readMaterials(formData: FormData): string[] {
  const all = formData.getAll("affectedMaterials");
  return all.map((m) => String(m)).filter((m) => isAffectedMaterial(m));
}

function readForm(formData: FormData) {
  const o = Object.fromEntries(formData.entries()) as Record<string, string>;
  // affectedMaterials is multi-valued; do not include via fromEntries
  delete o.affectedMaterials;
  return o;
}

export async function createRoom(
  jobId: string,
  _prev: RoomActionResult,
  formData: FormData,
): Promise<RoomActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  const job = await loadJobForEdit(jobId);
  assertCan(actor, "job.update", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const parsed = roomSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path.join(".") || "_form";
      if (!fe[k]) fe[k] = issue.message;
    }
    return { ok: false, fieldErrors: fe };
  }

  const max = await prisma.room.aggregate({
    where: { jobId },
    _max: { sortOrder: true },
  });
  const sortOrder = (max._max.sortOrder ?? -1) + 1;

  const materials = readMaterials(formData);

  const room = await prisma.room.create({
    data: {
      jobId,
      name: parsed.data.name,
      floor: parsed.data.floor,
      lengthFt: parsed.data.lengthFt ?? null,
      widthFt: parsed.data.widthFt ?? null,
      heightFt: parsed.data.heightFt ?? 8.0,
      category: parsed.data.category,
      classOfLoss: parsed.data.classOfLoss,
      notes: parsed.data.notes,
      affectedMaterials: materials,
      sortOrder,
    },
  });

  await recordAudit(
    "room.create",
    { actor: { userId: actor.id }, jobId },
    { roomId: room.id, name: room.name },
  );

  revalidatePath(`/app/jobs/${jobId}/rooms`);
  return { ok: true, message: `Added ${room.name}.` };
}

export async function updateRoom(
  jobId: string,
  roomId: string,
  _prev: RoomActionResult,
  formData: FormData,
): Promise<RoomActionResult> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  const job = await loadJobForEdit(jobId);
  assertCan(actor, "job.update", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { jobId: true },
  });
  if (!room || room.jobId !== jobId) return { ok: false, message: "Room not found" };

  const parsed = roomSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path.join(".") || "_form";
      if (!fe[k]) fe[k] = issue.message;
    }
    return { ok: false, fieldErrors: fe };
  }

  const materials = readMaterials(formData);

  await prisma.room.update({
    where: { id: roomId },
    data: {
      name: parsed.data.name,
      floor: parsed.data.floor,
      lengthFt: parsed.data.lengthFt ?? null,
      widthFt: parsed.data.widthFt ?? null,
      heightFt: parsed.data.heightFt ?? null,
      category: parsed.data.category,
      classOfLoss: parsed.data.classOfLoss,
      notes: parsed.data.notes,
      affectedMaterials: materials,
    },
  });

  await recordAudit(
    "room.update",
    { actor: { userId: actor.id }, jobId },
    { roomId },
  );

  revalidatePath(`/app/jobs/${jobId}/rooms`);
  return { ok: true, message: "Saved." };
}

export async function deleteRoom(input: { jobId: string; roomId: string }) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");

  const job = await loadJobForEdit(input.jobId);
  assertCan(actor, "job.update", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const room = await prisma.room.findUnique({
    where: { id: input.roomId },
    select: { jobId: true, name: true },
  });
  if (!room || room.jobId !== input.jobId) throw new Error("Room not found");

  await prisma.room.delete({ where: { id: input.roomId } });

  await recordAudit(
    "room.delete",
    { actor: { userId: actor.id }, jobId: input.jobId },
    { roomId: input.roomId, name: room.name },
  );

  revalidatePath(`/app/jobs/${input.jobId}/rooms`);
}

export async function reorderRooms(input: { jobId: string; orderedRoomIds: string[] }) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");

  const job = await loadJobForEdit(input.jobId);
  assertCan(actor, "job.update", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  // Validate all rooms belong to this job
  const rooms = await prisma.room.findMany({
    where: { id: { in: input.orderedRoomIds }, jobId: input.jobId },
    select: { id: true },
  });
  if (rooms.length !== input.orderedRoomIds.length) {
    throw new Error("One or more rooms don't belong to this job");
  }

  await prisma.$transaction(
    input.orderedRoomIds.map((id, idx) =>
      prisma.room.update({ where: { id }, data: { sortOrder: idx } }),
    ),
  );

  await recordAudit(
    "room.reorder",
    { actor: { userId: actor.id }, jobId: input.jobId },
    { count: input.orderedRoomIds.length },
  );

  revalidatePath(`/app/jobs/${input.jobId}/rooms`);
}
