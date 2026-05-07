"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import {
  newScene,
  normaliseAndRecompute,
  parseScene,
  totalAreas,
} from "@/lib/business/sketch/scene";

async function loadJob(jobId: string) {
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

const createSchema = z.object({
  jobId: z.string().min(1),
  name: z.string().trim().min(1).max(60).default("Floor 1"),
});

/**
 * Create a new Sketch with an empty scene. Redirects to the editor on
 * success.
 */
export async function createSketch(input: z.infer<typeof createSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = createSchema.parse(input);

  const job = await loadJob(data.jobId);
  assertCan(actor, "job.update", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  const scene = newScene();
  const sketch = await prisma.sketch.create({
    data: {
      jobId: data.jobId,
      name: data.name,
      sceneData: scene as object,
      version: 1,
    },
  });

  await recordAudit(
    "sketch.create",
    { actor: { userId: actor.id }, jobId: data.jobId },
    { sketchId: sketch.id, name: data.name },
  );

  revalidatePath(`/app/jobs/${data.jobId}/sketches`);
  return { sketchId: sketch.id };
}

const saveSchema = z.object({
  sketchId: z.string().min(1),
  /** Client-supplied scene JSON; we re-parse + normalise server-side. */
  scene: z.unknown(),
});

/**
 * Persist scene JSON. Auto-saves are debounced client-side at 5 s; this
 * action also recomputes per-room sqft/perimeter and the totals stored
 * alongside the JSON for fast list rendering.
 */
export async function saveScene(input: z.infer<typeof saveSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = saveSchema.parse(input);

  const sketch = await prisma.sketch.findUnique({
    where: { id: data.sketchId },
    select: {
      id: true,
      jobId: true,
      version: true,
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
  if (!sketch) throw new Error("Sketch not found");
  assertCan(actor, "job.update", {
    id: sketch.job.id,
    organizationId: sketch.job.organizationId,
    assignedUserIds: sketch.job.assignments.map((a) => a.userId),
    createdById: sketch.job.createdById,
  });

  const parsed = parseScene(data.scene);
  const recomputed = normaliseAndRecompute(parsed);
  const totals = totalAreas(recomputed);

  await prisma.sketch.update({
    where: { id: data.sketchId },
    data: {
      sceneData: recomputed as object,
      totalSqFt: totals.totalSqFt,
      totalLinearFt: totals.totalLinearFt,
      version: sketch.version + 1,
      // The PNG/PDF caches are now stale — clear them.
      pngStorageKey: null,
      pdfStorageKey: null,
    },
  });

  return {
    version: sketch.version + 1,
    totalSqFt: totals.totalSqFt,
    totalLinearFt: totals.totalLinearFt,
  };
}

const renameSchema = z.object({
  sketchId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
});

export async function renameSketch(input: z.infer<typeof renameSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = renameSchema.parse(input);

  const sketch = await prisma.sketch.findUnique({
    where: { id: data.sketchId },
    select: {
      jobId: true,
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
  if (!sketch) throw new Error("Sketch not found");
  assertCan(actor, "job.update", {
    id: sketch.job.id,
    organizationId: sketch.job.organizationId,
    assignedUserIds: sketch.job.assignments.map((a) => a.userId),
    createdById: sketch.job.createdById,
  });

  await prisma.sketch.update({
    where: { id: data.sketchId },
    data: { name: data.name },
  });

  await recordAudit(
    "sketch.rename",
    { actor: { userId: actor.id }, jobId: sketch.jobId },
    { sketchId: data.sketchId, name: data.name },
  );

  revalidatePath(`/app/jobs/${sketch.jobId}/sketches`);
}

const deleteSchema = z.object({ sketchId: z.string().min(1) });

export async function deleteSketch(input: z.infer<typeof deleteSchema>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = deleteSchema.parse(input);

  const sketch = await prisma.sketch.findUnique({
    where: { id: data.sketchId },
    select: {
      jobId: true,
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
  if (!sketch) return;
  assertCan(actor, "job.update", {
    id: sketch.job.id,
    organizationId: sketch.job.organizationId,
    assignedUserIds: sketch.job.assignments.map((a) => a.userId),
    createdById: sketch.job.createdById,
  });

  await prisma.sketch.delete({ where: { id: data.sketchId } });

  await recordAudit(
    "sketch.delete",
    { actor: { userId: actor.id }, jobId: sketch.jobId },
    { sketchId: data.sketchId },
  );

  revalidatePath(`/app/jobs/${sketch.jobId}/sketches`);
}
