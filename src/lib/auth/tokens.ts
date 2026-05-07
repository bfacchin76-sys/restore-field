import "server-only";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { type VerificationPurpose } from "@prisma/client";
import { prisma } from "@/lib/db";

const TOKEN_BYTES = 32;

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export interface IssueTokenInput {
  purpose: VerificationPurpose;
  email: string;
  userId?: string | null;
  organizationId?: string | null;
  ttlMs: number;
  payload?: Record<string, unknown>;
}

export interface IssuedToken {
  /** Raw token to put in the link or send to the user. Never persisted. */
  rawToken: string;
  /** Database row id. */
  id: string;
  expiresAt: Date;
}

/**
 * Issues a single-use verification token. Stores only the SHA-256 hash;
 * the raw token is returned once and only once.
 */
export async function issueVerificationToken(
  input: IssueTokenInput,
): Promise<IssuedToken> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + input.ttlMs);

  const row = await prisma.verificationToken.create({
    data: {
      tokenHash,
      purpose: input.purpose,
      email: input.email.toLowerCase(),
      userId: input.userId ?? null,
      organizationId: input.organizationId ?? null,
      payload: (input.payload ?? undefined) as object | undefined,
      expiresAt,
    },
  });

  return { rawToken, id: row.id, expiresAt };
}

/**
 * Looks up a token by raw value, validates expiry/single-use,
 * and returns the row. Does NOT mark it consumed — call markUsed
 * once the action completes successfully.
 */
export async function findUsableToken(
  rawToken: string,
  purpose: VerificationPurpose,
) {
  if (!rawToken || rawToken.length !== TOKEN_BYTES * 2) return null;
  const tokenHash = hashToken(rawToken);
  const row = await prisma.verificationToken.findUnique({
    where: { tokenHash },
  });
  if (!row) return null;
  if (row.purpose !== purpose) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function markTokenUsed(id: string): Promise<void> {
  await prisma.verificationToken.update({
    where: { id },
    data: { usedAt: new Date() },
  });
}

/**
 * Best-effort cleanup of expired tokens. Cheap; safe to call on demand.
 */
export async function purgeExpiredTokens(): Promise<number> {
  const { count } = await prisma.verificationToken.deleteMany({
    where: { expiresAt: { lt: new Date() }, usedAt: null },
  });
  return count;
}
