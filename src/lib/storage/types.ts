/**
 * Generic blob storage interface used by the photos / sketches / reports
 * pipelines (PRD §10). One of two implementations is selected at runtime:
 *
 *   - `S3Storage`     — for production. Talks to MinIO / Cloudflare R2 /
 *                       any S3-compatible endpoint via `@aws-sdk/client-s3`.
 *   - `LocalStorage`  — for development when no S3 endpoint is configured.
 *                       Files live under `${LOCAL_STORAGE_DIR}` and the
 *                       "presigned" URLs are HMAC-signed paths handled by
 *                       a Next.js route at `/api/storage/[...path]`.
 *
 * Either way the surface is identical: callers issue presigned URLs,
 * the browser uploads/downloads directly, the server never proxies.
 */

export interface PresignedPutInput {
  key: string;
  contentType: string;
  /** Maximum object size the URL will accept, in bytes. */
  maxSizeBytes?: number;
  /** Time-to-live in seconds. Default 15 minutes. */
  ttlSeconds?: number;
}

export interface PresignedPut {
  url: string;
  /** Required headers the client must echo on its PUT request. */
  headers: Record<string, string>;
  /** Final object key once the upload completes. */
  key: string;
  expiresAt: Date;
}

export interface PresignedGetInput {
  key: string;
  ttlSeconds?: number;
}

export interface PresignedGet {
  url: string;
  expiresAt: Date;
}

export interface Storage {
  /** Used by browsers to upload directly to storage. */
  presignedPut(input: PresignedPutInput): Promise<PresignedPut>;
  /** Short-lived URL the browser uses to render an image. */
  presignedGet(input: PresignedGetInput): Promise<PresignedGet>;
  /** Read the bytes server-side (worker pipelines). */
  getObjectBytes(key: string): Promise<Buffer>;
  /** Write bytes server-side (worker pipelines). */
  putObjectBytes(
    key: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<void>;
  /** Move an object server-side. Used to promote tmp/ uploads to final keys. */
  copyObject(fromKey: string, toKey: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  /** Best-effort existence check. */
  exists(key: string): Promise<boolean>;
}
