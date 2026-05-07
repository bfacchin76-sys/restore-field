import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";

/**
 * Generate the next job number for an organization, atomically.
 *
 * Format: `{prefix}-{year}-{0001..}` (PRD §8.1).
 *
 * Implementation: a `JobNumberCounter (organizationId, year)` row holds the
 * `nextSeq`. We use Postgres `INSERT … ON CONFLICT … DO UPDATE … RETURNING`
 * which is atomic — concurrent callers always see distinct values, no
 * row-level locking needed.
 */
export async function generateJobNumber(
  organizationId: string,
  client: Prisma.TransactionClient | PrismaClient = defaultPrisma,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();

  const org = await client.organization.findUnique({
    where: { id: organizationId },
    select: { jobNumberPrefix: true },
  });
  if (!org) throw new Error(`Organization ${organizationId} not found`);

  // Atomic upsert + increment in one round-trip. The CTE returns the
  // sequence value reserved for this caller. INSERT … RETURNING for the
  // first hit; UPDATE … RETURNING for every subsequent hit.
  const rows = await client.$queryRaw<{ nextSeq: number }[]>(Prisma.sql`
    INSERT INTO "JobNumberCounter" ("id", "organizationId", "year", "nextSeq")
    VALUES (
      gen_random_uuid()::text,
      ${organizationId},
      ${year},
      2
    )
    ON CONFLICT ("organizationId", "year") DO UPDATE
      SET "nextSeq" = "JobNumberCounter"."nextSeq" + 1
    RETURNING ("nextSeq" - 1) AS "nextSeq"
  `);

  const seq = rows[0]?.nextSeq;
  if (typeof seq !== "number" || seq < 1) {
    throw new Error("Failed to allocate job number sequence");
  }

  return formatJobNumber(org.jobNumberPrefix, year, seq);
}

export function formatJobNumber(
  prefix: string,
  year: number,
  seq: number,
): string {
  const padded = String(seq).padStart(4, "0");
  return `${prefix}-${year}-${padded}`;
}
