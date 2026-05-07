/**
 * Minimal type declarations for piexifjs — used in tests/scripts to write
 * EXIF (including a real GPS IFD) into JPEG buffers.
 */
declare module "piexifjs" {
  // piexifjs is duck-typed; tag values vary by tag (string, int, rational
  // pair `[num, denom]`, or arrays of rationals for GPS coords). Use `unknown`
  // to keep the public surface usable without a brittle tag-by-tag mapping.
  type ExifIfdMap = Record<number, unknown>;

  export interface ExifObject {
    "0th"?: ExifIfdMap;
    Exif?: ExifIfdMap;
    GPS?: ExifIfdMap;
    Interop?: ExifIfdMap;
    "1st"?: ExifIfdMap;
    thumbnail?: string | null;
  }

  export const ImageIFD: Record<string, number>;
  export const ExifIFD: Record<string, number>;
  export const GPSIFD: Record<string, number>;
  export const InteropIFD: Record<string, number>;

  export function dump(obj: ExifObject): string;
  export function load(jpegBinary: string): ExifObject;
  export function insert(exifBinary: string, jpegBinary: string): string;
  export function remove(jpegBinary: string): string;
}
