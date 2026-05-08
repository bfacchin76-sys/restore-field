import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type {
  PresignedGet,
  PresignedGetInput,
  PresignedPut,
  PresignedPutInput,
  Storage,
} from "./types";
import { env } from "@/lib/env";

/**
 * Filesystem-backed Storage adapter for local dev when no S3 endpoint is
 * configured. Files live under `LOCAL_STORAGE_DIR`. "Presigned" URLs are
 * HMAC-signed paths handled by /api/storage/[...path]/route.ts.
 */
const ROOT =
  process.env.LOCAL_STORAGE_DIR ?? join(process.cwd(), ".storage");
const SECRET = env.AUTH_SECRET; // re-use existing secret material for signing
const DEFAULT_PUT_TTL = 60 * 15;
const DEFAULT_GET_TTL = 60 * 15;

interface LocalSig {
  k: string;
  m: "GET" | "PUT";
  t: number; // unix-ms expiry
  c?: string; // contentType (PUT only)
  n: string; // nonce
  /** User id at issue time. Audit H5: PUT/GET routes verify the
   *  current session matches this id, so a leaked URL can't be
   *  replayed by a different user (tokens are still HMAC-signed,
   *  so values can't be forged). */
  u: string;
  /** Organization id at issue time — same purpose as `u`. */
  o: string;
}

function sign(payload: LocalSig): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString("base64url");
  const mac = createHmac("sha256", SECRET).update(b64).digest("base64url");
  return `${b64}.${mac}`;
}

export function verifyLocalSignature(
  token: string,
  method: "GET" | "PUT",
): LocalSig | null {
  const [b64, mac] = token.split(".");
  if (!b64 || !mac) return null;
  const expected = createHmac("sha256", SECRET).update(b64).digest("base64url");
  if (expected !== mac) return null;
  let payload: LocalSig;
  try {
    payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.m !== method) return null;
  if (payload.t < Date.now()) return null;
  return payload;
}

function safeKeyToPath(key: string): string {
  if (key.includes("..") || key.startsWith("/")) {
    throw new Error("Invalid storage key");
  }
  // Normalise separators to OS native; keys use forward slashes.
  return join(ROOT, key.split("/").join(sep));
}

export class LocalStorage implements Storage {
  async presignedPut(input: PresignedPutInput): Promise<PresignedPut> {
    if (!input.actor) {
      throw new Error(
        "LocalStorage.presignedPut requires `actor` (userId + organizationId).",
      );
    }
    const ttl = input.ttlSeconds ?? DEFAULT_PUT_TTL;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const token = sign({
      k: input.key,
      m: "PUT",
      t: expiresAt.getTime(),
      c: input.contentType,
      n: randomBytes(8).toString("hex"),
      u: input.actor.userId,
      o: input.actor.organizationId,
    });
    const url = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/api/storage/upload?token=${encodeURIComponent(token)}`;
    return {
      url,
      headers: { "Content-Type": input.contentType },
      key: input.key,
      expiresAt,
    };
  }

  async presignedGet(input: PresignedGetInput): Promise<PresignedGet> {
    if (!input.actor) {
      throw new Error(
        "LocalStorage.presignedGet requires `actor` (userId + organizationId).",
      );
    }
    const ttl = input.ttlSeconds ?? DEFAULT_GET_TTL;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const token = sign({
      k: input.key,
      m: "GET",
      t: expiresAt.getTime(),
      n: randomBytes(8).toString("hex"),
      u: input.actor.userId,
      o: input.actor.organizationId,
    });
    const url = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/api/storage/download?token=${encodeURIComponent(token)}`;
    return { url, expiresAt };
  }

  async getObjectBytes(key: string): Promise<Buffer> {
    return readFile(safeKeyToPath(key));
  }

  async putObjectBytes(
    key: string,
    bytes: Buffer,
    _contentType: string,
  ): Promise<void> {
    void _contentType;
    const path = safeKeyToPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async copyObject(fromKey: string, toKey: string): Promise<void> {
    const from = safeKeyToPath(fromKey);
    const to = safeKeyToPath(toKey);
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  }

  async deleteObject(key: string): Promise<void> {
    await rm(safeKeyToPath(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(safeKeyToPath(key));
      return true;
    } catch {
      return false;
    }
  }
}

export const LOCAL_STORAGE_ROOT = ROOT;
