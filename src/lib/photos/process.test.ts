// @vitest-environment node

/**
 * Sharp pipeline integration test. Generates synthetic JPEG/PNG/WebP
 * via Sharp itself, then runs them through processImage() and asserts:
 *
 *   - dimensions reflect the resized output
 *   - thumb max edge ≤ 320, medium max edge ≤ 1280
 *   - originals are byte-identical for non-HEIC inputs (no transcode)
 *   - a JPEG with EXIF GPS exposes lat/lng on the result
 *
 * HEIC support is opportunistic — it depends on libheif being available
 * to libvips. The HEIC test is skipped if Sharp can't decode `image/heif`.
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
// piexifjs is a pure-JS EXIF writer. We use it in tests because Sharp's
// `withExif` doesn't reliably persist the GPS IFD.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const piexif: typeof import("piexifjs") = require("piexifjs");
import { processImage } from "./process";

async function syntheticJpeg(width = 400, height = 300): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 12, g: 60, b: 145 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function syntheticPng(width = 200, height = 200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 240, g: 200, b: 32, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

async function jpegWithExif(): Promise<Buffer> {
  // Build the JPEG with Sharp, then inject EXIF via piexifjs which can
  // write a fully-valid GPS IFD that exifr can parse back out.
  const base = await syntheticJpeg(800, 600);
  const exifObj = {
    "0th": {
      [piexif.ImageIFD.Make]: "Canon",
      [piexif.ImageIFD.Model]: "EOS R5",
      [piexif.ImageIFD.DateTime]: "2026:04:15 14:30:00",
    },
    Exif: {
      [piexif.ExifIFD.DateTimeOriginal]: "2026:04:15 14:30:00",
      [piexif.ExifIFD.DateTimeDigitized]: "2026:04:15 14:30:00",
    },
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: "N",
      [piexif.GPSIFD.GPSLatitude]: [
        [40, 1],
        [45, 1],
        [0, 1],
      ],
      [piexif.GPSIFD.GPSLongitudeRef]: "W",
      [piexif.GPSIFD.GPSLongitude]: [
        [73, 1],
        [30, 1],
        [0, 1],
      ],
    },
  };
  const exifBytes = piexif.dump(exifObj);
  // piexifjs takes binary strings, not Buffers.
  const baseBinary = base.toString("binary");
  const newBinary = piexif.insert(exifBytes, baseBinary);
  return Buffer.from(newBinary, "binary");
}

describe("processImage pipeline", () => {
  it("processes a PNG without transcoding the original", async () => {
    const input = await syntheticPng(640, 480);
    const r = await processImage(input, "image/png");

    expect(r.originalWasConverted).toBe(false);
    expect(r.originalMime).toBe("image/png");
    expect(r.originalExt).toBe("png");
    expect(r.originalBytes.equals(input)).toBe(true);

    expect(r.width).toBe(640);
    expect(r.height).toBe(480);

    const thumbMeta = await sharp(r.thumbBytes).metadata();
    expect(thumbMeta.format).toBe("webp");
    expect(Math.max(thumbMeta.width ?? 0, thumbMeta.height ?? 0)).toBeLessThanOrEqual(320);

    const medMeta = await sharp(r.mediumBytes).metadata();
    expect(medMeta.format).toBe("webp");
    expect(Math.max(medMeta.width ?? 0, medMeta.height ?? 0)).toBeLessThanOrEqual(1280);
  });

  it("doesn't enlarge below the original", async () => {
    const input = await syntheticJpeg(80, 60);
    const r = await processImage(input, "image/jpeg");
    const thumbMeta = await sharp(r.thumbBytes).metadata();
    // thumb cap is 320; original is 80 — thumb shouldn't grow it.
    expect(thumbMeta.width).toBe(80);
    expect(thumbMeta.height).toBe(60);
  });

  it("extracts EXIF GPS / device / takenAt", async () => {
    const input = await jpegWithExif();
    const r = await processImage(input, "image/jpeg");
    expect(r.deviceModel).toMatch(/Canon/);
    expect(r.gpsLat).not.toBeNull();
    expect(r.gpsLng).not.toBeNull();
    expect(r.gpsLat!).toBeCloseTo(40.75, 1);
    expect(r.gpsLng!).toBeCloseTo(-73.5, 1);
    expect(r.takenAt).toBeInstanceOf(Date);
  });

  it("rejects SVG bytes even when MIME claims image/svg", async () => {
    // PRD §11: SVG can carry script — keep it out of the photo pipeline.
    const svg = Buffer.from(
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`,
    );
    await expect(processImage(svg, "image/svg+xml")).rejects.toThrow(
      /not an allowed photo type/,
    );
  });

  it("rejects non-image bytes (PDF magic) with a clear error", async () => {
    const pdfMagic = Buffer.from("%PDF-1.4\n%fake\n", "utf8");
    // Sharp throws on metadata() for non-images; either Sharp's error or
    // our gate fires — we just want a thrown error, not silent acceptance.
    await expect(processImage(pdfMagic, "image/jpeg")).rejects.toThrow();
  });

  it("transcodes HEIC to JPEG when libheif is available", async () => {
    // Try to round-trip an HEIC. If libheif isn't compiled into libvips,
    // skip — Sharp throws on encode. PRD §8.2 and §11 require this in
    // production; the test makes sure the code path works when libheif IS
    // present.
    let heic: Buffer;
    try {
      heic = await sharp({
        create: {
          width: 320,
          height: 240,
          channels: 3,
          background: { r: 50, g: 100, b: 200 },
        },
      })
        .heif({ compression: "hevc" })
        .toBuffer();
    } catch {
      console.warn("[heic test] libheif not available, skipping");
      return;
    }
    const r = await processImage(heic, "image/heic");
    expect(r.originalWasConverted).toBe(true);
    expect(r.originalMime).toBe("image/jpeg");
    expect(r.originalExt).toBe("jpg");
    // The transcoded JPEG should still have ~the same dimensions.
    expect(r.width).toBe(320);
    expect(r.height).toBe(240);
  });
});
