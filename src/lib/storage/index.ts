import "server-only";
import type { Storage } from "./types";
import { S3Storage } from "./s3";
import { LocalStorage } from "./local";
import { env } from "@/lib/env";

let cached: Storage | null = null;

export type StorageDriver = "s3" | "local";

export function resolveStorageDriver(): StorageDriver {
  const explicit = process.env.STORAGE_DRIVER?.toLowerCase();
  if (explicit === "s3" || explicit === "local") return explicit;
  // Default: S3 if all of (endpoint, access key, secret key) are configured.
  if (env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY) return "s3";
  return "local";
}

export function getStorage(): Storage {
  if (cached) return cached;
  cached = resolveStorageDriver() === "s3" ? new S3Storage() : new LocalStorage();
  return cached;
}

/** Test-only: reset the cached driver. */
export function _resetStorageForTests() {
  cached = null;
}

export type { Storage } from "./types";
