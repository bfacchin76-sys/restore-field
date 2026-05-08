import "server-only";
import sharp from "sharp";
import exifr from "exifr";

export interface ProcessedImage {
  /** The bytes of the canonical "original" — for HEIC/HEIF we transcode to JPEG.
   *  For all other formats, the original buffer is returned untouched. */
  originalBytes: Buffer;
  /** Extension (without dot) for the canonical original. */
  originalExt: string;
  /** Content-Type for the canonical original. */
  originalMime: string;
  /** Was the original transcoded (HEIC → JPEG)? */
  originalWasConverted: boolean;
  /** Thumbnail (webp, ~320 max edge). */
  thumbBytes: Buffer;
  /** Medium-quality preview (webp, ~1280 max edge). */
  mediumBytes: Buffer;
  width: number;
  height: number;
  takenAt: Date | null;
  gpsLat: number | null;
  gpsLng: number | null;
  deviceModel: string | null;
}

const THUMB_EDGE = 320;
const MEDIUM_EDGE = 1280;
const THUMB_QUALITY = 80;
const MEDIUM_QUALITY = 85;

/**
 * Sharp can decode many formats; for our pipeline only photo-style
 * raster images are valid. SVG would let user-content embed scripts;
 * PDF / TIFF / RAW would surprise downstream code. PRD §11 task 6.
 */
const ALLOWED_IMAGE_FORMATS = new Set<string>([
  "jpeg",
  "png",
  "webp",
  "gif",
  "heif",
]);

/**
 * Magic-byte sniff against the first ~16 bytes of the upload. Returns
 * one of the ALLOWED_IMAGE_FORMATS strings or null. Audit H3: we run
 * this BEFORE handing the buffer to Sharp's `metadata()` so a future
 * libvips parser CVE in TIFF/SVG/PDF can't be triggered by hostile
 * input that we'd reject anyway.
 */
function sniffMagicBytes(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return "gif";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "webp";
  }
  // HEIF/HEIC: ISO BMFF box "ftyp" + brand starting at byte 8.
  // Brands we accept: heic, heix, heim, heis, hevc, hevx, mif1, msf1.
  if (
    buf[4] === 0x66 && // 'f'
    buf[5] === 0x74 && // 't'
    buf[6] === 0x79 && // 'y'
    buf[7] === 0x70 // 'p'
  ) {
    const brand = buf.subarray(8, 12).toString("ascii");
    if (
      brand === "heic" ||
      brand === "heix" ||
      brand === "heim" ||
      brand === "heis" ||
      brand === "hevc" ||
      brand === "hevx" ||
      brand === "mif1" ||
      brand === "msf1"
    ) {
      return "heif";
    }
  }
  return null;
}

/**
 * Run the full Sharp pipeline against an uploaded image.
 *
 *   1. Detect format. If HEIC/HEIF, transcode to JPEG (the canonical "original").
 *   2. Strip EXIF off derivatives but preserve it on the original.
 *   3. Generate thumb.webp (max edge 320, q=80).
 *   4. Generate medium.webp (max edge 1280, q=85).
 *   5. Read EXIF (taken date, GPS, device).
 *
 * Returns everything the worker needs to upload + persist on the Photo row.
 */
export async function processImage(
  inputBytes: Buffer,
  uploadedMime: string,
): Promise<ProcessedImage> {
  // 1. Sniff format. PRD §11 / audit H3: magic-byte gate runs BEFORE
  //    Sharp's `metadata()` so a libvips parser CVE in TIFF/SVG/PDF
  //    can't fire on hostile bytes we'd reject anyway. Sharp's
  //    detection is then used as a second-opinion check (it would
  //    catch a buffer whose first bytes look like a JPEG but is
  //    actually something else past byte 16).
  const sniffed = sniffMagicBytes(inputBytes);
  if (!sniffed || !ALLOWED_IMAGE_FORMATS.has(sniffed)) {
    throw new Error(
      `Rejecting upload: detected format "${sniffed ?? "unknown"}" is not an allowed photo type.`,
    );
  }
  const baseMeta = await sharp(inputBytes).metadata();
  const format = baseMeta.format ?? "";
  if (!ALLOWED_IMAGE_FORMATS.has(format) || format !== sniffed) {
    throw new Error(
      `Rejecting upload: Sharp says "${format || "unknown"}", magic bytes say "${sniffed}".`,
    );
  }

  // 2. Decide canonical original
  let originalBytes = inputBytes;
  let originalMime = uploadedMime;
  let originalExt = extFromFormat(format) ?? extFromMime(uploadedMime);
  let originalWasConverted = false;

  if (format === "heif" || /heic|heif/i.test(uploadedMime)) {
    // Sharp's HEIF support depends on libheif being compiled in. If it
    // can't decode, the call below throws; the worker will mark
    // processingError and surface it to the admin per PRD §11.
    originalBytes = await sharp(inputBytes)
      .rotate() // honour orientation
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    originalMime = "image/jpeg";
    originalExt = "jpg";
    originalWasConverted = true;
  }

  // Use the (possibly transcoded) canonical original as the source for
  // derivative generation so EXIF can be safely stripped.
  const sourceForDerivatives = sharp(originalBytes).rotate();
  const sourceMeta = await sourceForDerivatives.metadata();
  const width = sourceMeta.width ?? 0;
  const height = sourceMeta.height ?? 0;

  const [thumbBytes, mediumBytes] = await Promise.all([
    sharp(originalBytes)
      .rotate()
      .resize({
        width: THUMB_EDGE,
        height: THUMB_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer(),
    sharp(originalBytes)
      .rotate()
      .resize({
        width: MEDIUM_EDGE,
        height: MEDIUM_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: MEDIUM_QUALITY })
      .toBuffer(),
  ]);

  // 3. EXIF — pulled from the *original input* (so HEIC EXIF survives even
  // though we transcoded to JPEG above; sharp's `.jpeg()` preserves it
  // when set, but we read from input to be safe).
  const exif = await readExif(inputBytes);

  return {
    originalBytes,
    originalExt,
    originalMime,
    originalWasConverted,
    thumbBytes,
    mediumBytes,
    width,
    height,
    takenAt: exif.takenAt,
    gpsLat: exif.gpsLat,
    gpsLng: exif.gpsLng,
    deviceModel: exif.deviceModel,
  };
}

interface ExifSummary {
  takenAt: Date | null;
  gpsLat: number | null;
  gpsLng: number | null;
  deviceModel: string | null;
}

async function readExif(bytes: Buffer): Promise<ExifSummary> {
  try {
    const tags = (await exifr.parse(bytes, {
      tiff: true,
      exif: true,
      gps: true,
      reviveValues: true,
    })) as
      | {
          DateTimeOriginal?: Date | string;
          CreateDate?: Date | string;
          DateTime?: Date | string;
          latitude?: number;
          longitude?: number;
          GPSLatitude?: number;
          GPSLongitude?: number;
          Model?: string;
          Make?: string;
        }
      | undefined;
    if (!tags) return blankExif();

    const taken =
      asDate(tags.DateTimeOriginal) ??
      asDate(tags.CreateDate) ??
      asDate(tags.DateTime);
    const lat =
      typeof tags.latitude === "number"
        ? tags.latitude
        : typeof tags.GPSLatitude === "number"
          ? tags.GPSLatitude
          : null;
    const lng =
      typeof tags.longitude === "number"
        ? tags.longitude
        : typeof tags.GPSLongitude === "number"
          ? tags.GPSLongitude
          : null;
    const device = [tags.Make, tags.Model]
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .join(" ");
    return {
      takenAt: taken,
      gpsLat: Number.isFinite(lat) && lat !== null ? lat : null,
      gpsLng: Number.isFinite(lng) && lng !== null ? lng : null,
      deviceModel: device || null,
    };
  } catch {
    return blankExif();
  }
}

function blankExif(): ExifSummary {
  return { takenAt: null, gpsLat: null, gpsLng: null, deviceModel: null };
}

function asDate(v: Date | string | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extFromFormat(format: string): string | null {
  switch (format) {
    case "jpeg":
      return "jpg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "gif":
      return "gif";
    case "heif":
      return "heic";
    default:
      return null;
  }
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("jpeg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic") || m.includes("heif")) return "heic";
  if (m.includes("gif")) return "gif";
  return "jpg";
}
