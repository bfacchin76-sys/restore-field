import "server-only";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import {
  mediumKey as mkMedium,
  originalKey as mkOriginal,
  thumbKey as mkThumb,
} from "@/lib/photos/keys";
import { processImage } from "@/lib/photos/process";
import { logger } from "@/lib/logger";
import type { ImageProcessJob } from "../queues";

/**
 * Pipeline (PRD §11):
 *   1. Read tmp upload from storage.
 *   2. Run Sharp pipeline (HEIC→JPEG, EXIF, derivatives).
 *   3. Upload original / medium / thumb.
 *   4. Delete tmp upload.
 *   5. Stamp Photo row with metadata + processedAt.
 *   6. On failure: bump processingAttempts and store the message.
 */
export async function processImageJob(data: ImageProcessJob): Promise<void> {
  const photo = await prisma.photo.findUnique({
    where: { id: data.photoId },
    include: { job: { select: { organizationId: true } } },
  });
  if (!photo) {
    logger.warn({ photoId: data.photoId }, "image-process: photo missing");
    return;
  }

  await prisma.photo.update({
    where: { id: data.photoId },
    data: { processingAttempts: { increment: 1 }, processingError: null },
  });

  try {
    const storage = getStorage();
    const inputBytes = await storage.getObjectBytes(data.uploadKey);

    const r = await processImage(inputBytes, data.uploadedMime);

    const orgId = photo.job.organizationId;
    const finalOriginalKey = mkOriginal(orgId, photo.jobId, photo.id, r.originalExt);
    const finalMediumKey = mkMedium(orgId, photo.jobId, photo.id);
    const finalThumbKey = mkThumb(orgId, photo.jobId, photo.id);

    await Promise.all([
      storage.putObjectBytes(finalOriginalKey, r.originalBytes, r.originalMime),
      storage.putObjectBytes(finalMediumKey, r.mediumBytes, "image/webp"),
      storage.putObjectBytes(finalThumbKey, r.thumbBytes, "image/webp"),
    ]);

    // Best-effort tmp cleanup; don't fail the job if it errors.
    await storage
      .deleteObject(data.uploadKey)
      .catch((err) => logger.warn({ err }, "image-process: tmp cleanup failed"));

    await prisma.photo.update({
      where: { id: data.photoId },
      data: {
        storageKey: finalOriginalKey,
        thumbnailKey: finalThumbKey,
        mediumKey: finalMediumKey,
        mimeType: r.originalMime,
        sizeBytes: r.originalBytes.byteLength,
        width: r.width,
        height: r.height,
        takenAt: r.takenAt ?? undefined,
        gpsLat: r.gpsLat ?? undefined,
        gpsLng: r.gpsLng ?? undefined,
        deviceModel: r.deviceModel ?? undefined,
        processedAt: new Date(),
        processingError: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, photoId: data.photoId }, "image-process failed");
    await prisma.photo.update({
      where: { id: data.photoId },
      data: { processingError: message },
    });
    throw err; // let BullMQ retry per attempts policy
  }
}
