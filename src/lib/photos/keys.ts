/**
 * S3 key conventions for photos. Mirrors PRD §10.
 *
 *   orgs/{orgId}/jobs/{jobId}/photos/{photoId}/original.{ext}
 *   orgs/{orgId}/jobs/{jobId}/photos/{photoId}/medium.webp
 *   orgs/{orgId}/jobs/{jobId}/photos/{photoId}/thumb.webp
 *   tmp/{photoId}.{ext}                          (lifecycle-deleted)
 */

const ALLOWED_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  "gif",
]);

export function tmpKey(photoId: string, ext: string): string {
  const safe = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!ALLOWED_EXTS.has(safe)) {
    throw new Error(`Unsupported extension: ${ext}`);
  }
  return `tmp/${photoId}.${safe}`;
}

export function photoPrefix(
  orgId: string,
  jobId: string,
  photoId: string,
): string {
  return `orgs/${orgId}/jobs/${jobId}/photos/${photoId}`;
}

export function originalKey(
  orgId: string,
  jobId: string,
  photoId: string,
  ext: string,
): string {
  const safe = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${photoPrefix(orgId, jobId, photoId)}/original.${safe}`;
}

export function mediumKey(
  orgId: string,
  jobId: string,
  photoId: string,
): string {
  return `${photoPrefix(orgId, jobId, photoId)}/medium.webp`;
}

export function thumbKey(
  orgId: string,
  jobId: string,
  photoId: string,
): string {
  return `${photoPrefix(orgId, jobId, photoId)}/thumb.webp`;
}

export function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("jpeg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic")) return "heic";
  if (m.includes("heif")) return "heif";
  if (m.includes("gif")) return "gif";
  return "jpg";
}

export function isImageMime(mime: string): boolean {
  return /^image\/(jpeg|png|webp|heic|heif|gif)$/i.test(mime);
}

export const MAX_PHOTO_BYTES = 50 * 1024 * 1024; // 50 MB per PRD §16
