"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Salvageability } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { assertCan } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { getStorage } from "@/lib/storage";
import { getImageProcessQueue } from "@/lib/queue/queues";
import {
  MAX_PHOTO_BYTES,
  extFromMime,
  isImageMime,
  tmpKey,
} from "@/lib/photos/keys";

async function loadJobForEdit(jobId: string) {
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

const presignInput = z.object({
  jobId: z.string().min(1),
  files: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(256),
        mimeType: z.string().trim().min(1).max(64),
        size: z.number().int().nonnegative().max(MAX_PHOTO_BYTES),
      }),
    )
    .min(1)
    .max(50),
});

export interface PresignedUpload {
  photoId: string;
  url: string;
  headers: Record<string, string>;
  uploadKey: string;
  /** Reported MIME — echoed back to finalize() */
  mimeType: string;
  /** Reported size — echoed back to finalize() */
  size: number;
  /** Reported original filename */
  filename: string;
}

/**
 * Reserves Photo rows + presigned PUT URLs for a batch of files.
 * The browser then PUTs each file at its URL and calls finalize() with
 * the photoIds it has uploaded. Files larger than 50 MB or non-image
 * MIME types are rejected.
 */
export async function presignPhotoUploads(
  input: z.infer<typeof presignInput>,
): Promise<{ ok: true; uploads: PresignedUpload[] } | { ok: false; message: string }> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  const parsed = presignInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { jobId, files } = parsed.data;

  const job = await loadJobForEdit(jobId);
  assertCan(actor, "photo.upload", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  for (const f of files) {
    if (!isImageMime(f.mimeType)) {
      return { ok: false, message: `Unsupported file type: ${f.mimeType}` };
    }
  }

  const storage = getStorage();
  const uploads: PresignedUpload[] = [];

  // Auto-promote DRAFT → ACTIVE on first photo (PRD §8.1).
  const shouldActivate = job.status === "DRAFT";

  for (const f of files) {
    const ext = extFromMime(f.mimeType);
    // Allocate the Photo row eagerly so we have a stable id for the key.
    const photo = await prisma.photo.create({
      data: {
        jobId,
        uploadedById: actor.id,
        storageKey: "", // filled in by the worker
        mimeType: f.mimeType,
        sizeBytes: f.size,
      },
    });
    const upKey = tmpKey(photo.id, ext);
    const presigned = await storage.presignedPut({
      key: upKey,
      contentType: f.mimeType,
      maxSizeBytes: f.size,
      ttlSeconds: 60 * 30,
      actor: { userId: actor.id, organizationId: actor.organizationId },
    });
    uploads.push({
      photoId: photo.id,
      url: presigned.url,
      headers: presigned.headers,
      uploadKey: upKey,
      mimeType: f.mimeType,
      size: f.size,
      filename: f.filename,
    });
  }

  if (shouldActivate) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "ACTIVE", firstResponseAt: new Date() },
    });
    await recordAudit(
      "job.status.update",
      { actor: { userId: actor.id }, jobId },
      { from: "DRAFT", to: "ACTIVE", reason: "first photo upload" },
    );
  }

  await recordAudit(
    "photo.batch.presigned",
    { actor: { userId: actor.id }, jobId },
    { count: uploads.length },
  );

  return { ok: true, uploads };
}

const finalizeInput = z.object({
  jobId: z.string().min(1),
  uploads: z
    .array(
      z.object({
        photoId: z.string().min(1),
        uploadKey: z.string().min(1),
        mimeType: z.string().min(1),
        roomId: z.string().nullable().optional(),
        caption: z.string().max(1000).optional(),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * Browser calls finalize() once it has PUT each file. We enqueue a
 * BullMQ image-process job per Photo. Optionally set caption/room at
 * the same time so users don't have to round-trip.
 */
export async function finalizePhotoUploads(
  input: z.infer<typeof finalizeInput>,
): Promise<{ ok: boolean; message?: string }> {
  const actor = await getSessionUser();
  if (!actor) return { ok: false, message: "Not signed in" };

  const parsed = finalizeInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { jobId, uploads } = parsed.data;

  const job = await loadJobForEdit(jobId);
  assertCan(actor, "photo.upload", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  // Validate that every photoId belongs to this job and was uploaded by the same user.
  const photos = await prisma.photo.findMany({
    where: {
      id: { in: uploads.map((u) => u.photoId) },
      jobId,
    },
    select: { id: true, uploadedById: true },
  });
  const validIds = new Set(photos.map((p) => p.id));

  const queue = getImageProcessQueue();

  for (const u of uploads) {
    if (!validIds.has(u.photoId)) continue;
    if (u.roomId) {
      const room = await prisma.room.findUnique({
        where: { id: u.roomId },
        select: { jobId: true },
      });
      if (!room || room.jobId !== jobId) {
        return {
          ok: false,
          message: `Room ${u.roomId} doesn't belong to this job`,
        };
      }
    }
    await prisma.photo.update({
      where: { id: u.photoId },
      data: {
        roomId: u.roomId ?? null,
        caption: u.caption ?? undefined,
      },
    });
    await queue.add("process", {
      photoId: u.photoId,
      uploadKey: u.uploadKey,
      uploadedMime: u.mimeType,
    });
  }

  await recordAudit(
    "photo.batch.finalize",
    { actor: { userId: actor.id }, jobId },
    { count: uploads.length },
  );

  revalidatePath(`/app/jobs/${jobId}/photos`);
  return { ok: true };
}

const updatePhotoInput = z.object({
  photoId: z.string().min(1),
  roomId: z.string().nullable().optional(),
  caption: z.string().max(1000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  salvageability: z.nativeEnum(Salvageability).nullable().optional(),
});

export async function updatePhoto(input: z.infer<typeof updatePhotoInput>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = updatePhotoInput.parse(input);

  const photo = await prisma.photo.findUnique({
    where: { id: data.photoId },
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
  if (!photo) throw new Error("Photo not found");

  assertCan(actor, "photo.upload", {
    id: photo.job.id,
    organizationId: photo.job.organizationId,
    assignedUserIds: photo.job.assignments.map((a) => a.userId),
    createdById: photo.job.createdById,
  });

  if (data.roomId) {
    const room = await prisma.room.findUnique({
      where: { id: data.roomId },
      select: { jobId: true },
    });
    if (!room || room.jobId !== photo.jobId) {
      throw new Error("Room doesn't belong to this job");
    }
  }

  await prisma.photo.update({
    where: { id: data.photoId },
    data: {
      roomId: data.roomId === undefined ? undefined : data.roomId,
      caption:
        data.caption === undefined ? undefined : data.caption?.trim() || null,
      tags: data.tags === undefined ? undefined : data.tags,
      salvageability: data.salvageability ?? undefined,
    },
  });

  await recordAudit(
    "photo.update",
    { actor: { userId: actor.id }, jobId: photo.jobId },
    {
      photoId: data.photoId,
      fields: Object.keys(data).filter((k) => k !== "photoId"),
    },
  );

  revalidatePath(`/app/jobs/${photo.jobId}/photos`);
}

const deleteInput = z.object({ photoId: z.string().min(1) });

export async function deletePhoto(input: z.infer<typeof deleteInput>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = deleteInput.parse(input);

  const photo = await prisma.photo.findUnique({
    where: { id: data.photoId },
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
  if (!photo) return;

  assertCan(actor, "photo.delete", {
    id: photo.job.id,
    organizationId: photo.job.organizationId,
    assignedUserIds: photo.job.assignments.map((a) => a.userId),
    createdById: photo.job.createdById,
  });

  const storage = getStorage();
  const keys = [photo.storageKey, photo.mediumKey, photo.thumbnailKey].filter(
    (k): k is string => typeof k === "string" && k.length > 0,
  );
  for (const k of keys) {
    await storage.deleteObject(k).catch(() => {});
  }

  await prisma.photo.delete({ where: { id: data.photoId } });

  await recordAudit(
    "photo.delete",
    { actor: { userId: actor.id }, jobId: photo.jobId },
    { photoId: data.photoId },
  );

  revalidatePath(`/app/jobs/${photo.jobId}/photos`);
}

const bulkUpdateInput = z.object({
  jobId: z.string().min(1),
  photoIds: z.array(z.string().min(1)).min(1).max(500),
  roomId: z.string().nullable().optional(),
  addTags: z.array(z.string().min(1).max(40)).max(10).optional(),
  salvageability: z.nativeEnum(Salvageability).nullable().optional(),
});

export async function bulkUpdatePhotos(input: z.infer<typeof bulkUpdateInput>) {
  const actor = await getSessionUser();
  if (!actor) throw new Error("Not signed in");
  const data = bulkUpdateInput.parse(input);

  const job = await loadJobForEdit(data.jobId);
  assertCan(actor, "photo.upload", {
    id: job.id,
    organizationId: job.organizationId,
    assignedUserIds: job.assignments.map((a) => a.userId),
    createdById: job.createdById,
  });

  if (data.roomId) {
    const room = await prisma.room.findUnique({
      where: { id: data.roomId },
      select: { jobId: true },
    });
    if (!room || room.jobId !== data.jobId) {
      throw new Error("Room doesn't belong to this job");
    }
  }

  const photos = await prisma.photo.findMany({
    where: { id: { in: data.photoIds }, jobId: data.jobId },
    select: { id: true, tags: true },
  });

  await prisma.$transaction(
    photos.map((p) =>
      prisma.photo.update({
        where: { id: p.id },
        data: {
          roomId: data.roomId === undefined ? undefined : data.roomId,
          salvageability: data.salvageability ?? undefined,
          tags:
            data.addTags && data.addTags.length > 0
              ? { set: Array.from(new Set([...p.tags, ...data.addTags])) }
              : undefined,
        },
      }),
    ),
  );

  await recordAudit(
    "photo.bulk.update",
    { actor: { userId: actor.id }, jobId: data.jobId },
    {
      count: photos.length,
      fields: Object.keys(data).filter(
        (k) => k !== "jobId" && k !== "photoIds",
      ),
    },
  );

  revalidatePath(`/app/jobs/${data.jobId}/photos`);
}
