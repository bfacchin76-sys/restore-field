import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Cross-entity search across Jobs / Customers / Photos for a single
 * organisation. Uses Postgres full-text indexes (created by the
 * 20260508012254 migration) plus a trigram fallback on jobNumber for
 * partial-prefix matches.
 *
 * Each result carries a relevance score so the UI can order by score
 * across mixed entity types.
 */

export interface SearchHit {
  kind: "job" | "customer" | "photo";
  id: string;
  /** Stable URL for the result inside /app. */
  href: string;
  title: string;
  subtitle: string;
  score: number;
}

export interface SearchOptions {
  organizationId: string;
  query: string;
  /** Max hits per kind. Default 10. */
  limit?: number;
}

export async function searchAcross({
  organizationId,
  query,
  limit = 10,
}: SearchOptions): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length === 0) return [];

  // Postgres `plainto_tsquery` accepts arbitrary user input safely (no
  // operator parsing). Trigram lookups use `%` similarity for
  // partial-text fallback.
  const tsQuery = q;
  const ilike = `%${q}%`;

  const [jobs, customers, photos] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        jobNumber: string;
        causeOfLoss: string | null;
        score: number;
        customerName: string;
      }>
    >(Prisma.sql`
      SELECT j.id, j."jobNumber", j."causeOfLoss",
             (c."firstName" || ' ' || c."lastName") AS "customerName",
             GREATEST(
               ts_rank_cd(
                 setweight(to_tsvector('simple'::regconfig, coalesce(j."jobNumber", '')), 'A') ||
                 setweight(to_tsvector('english'::regconfig, coalesce(j."causeOfLoss", '')), 'B') ||
                 setweight(to_tsvector('english'::regconfig, coalesce(j."scopeNotes", '')), 'C'),
                 plainto_tsquery('english'::regconfig, ${tsQuery})
               ),
               similarity(j."jobNumber", ${q})
             ) AS score
      FROM "Job" j
      JOIN "Customer" c ON c.id = j."customerId"
      WHERE j."organizationId" = ${organizationId}
        AND (
          j."jobNumber" ILIKE ${ilike}
          OR (
            setweight(to_tsvector('simple'::regconfig, coalesce(j."jobNumber", '')), 'A') ||
            setweight(to_tsvector('english'::regconfig, coalesce(j."causeOfLoss", '')), 'B') ||
            setweight(to_tsvector('english'::regconfig, coalesce(j."scopeNotes", '')), 'C')
          ) @@ plainto_tsquery('english'::regconfig, ${tsQuery})
        )
      ORDER BY score DESC
      LIMIT ${limit}
    `),
    prisma.$queryRaw<
      Array<{
        id: string;
        firstName: string;
        lastName: string;
        addressLine1: string;
        city: string;
        state: string;
        score: number;
      }>
    >(Prisma.sql`
      SELECT c.id, c."firstName", c."lastName", c."addressLine1", c.city, c.state,
             ts_rank_cd(
               setweight(to_tsvector('simple'::regconfig, c."firstName" || ' ' || c."lastName"), 'A') ||
               setweight(to_tsvector('english'::regconfig, coalesce(c."addressLine1", '') || ' ' || coalesce(c.city, '')), 'B') ||
               setweight(to_tsvector('simple'::regconfig, coalesce(c."policyNumber", '') || ' ' || coalesce(c."claimNumber", '')), 'C'),
               plainto_tsquery('english'::regconfig, ${tsQuery})
             ) AS score
      FROM "Customer" c
      WHERE c."organizationId" = ${organizationId}
        AND (
          c."lastName" ILIKE ${ilike}
          OR c."firstName" ILIKE ${ilike}
          OR c."policyNumber" ILIKE ${ilike}
          OR c."claimNumber" ILIKE ${ilike}
          OR (
            setweight(to_tsvector('simple'::regconfig, c."firstName" || ' ' || c."lastName"), 'A') ||
            setweight(to_tsvector('english'::regconfig, coalesce(c."addressLine1", '') || ' ' || coalesce(c.city, '')), 'B') ||
            setweight(to_tsvector('simple'::regconfig, coalesce(c."policyNumber", '') || ' ' || coalesce(c."claimNumber", '')), 'C')
          ) @@ plainto_tsquery('english'::regconfig, ${tsQuery})
        )
      ORDER BY score DESC
      LIMIT ${limit}
    `),
    prisma.$queryRaw<
      Array<{
        id: string;
        jobId: string;
        caption: string | null;
        jobNumber: string;
        score: number;
      }>
    >(Prisma.sql`
      SELECT p.id, p."jobId", p.caption, j."jobNumber",
             ts_rank_cd(
               to_tsvector('english'::regconfig, coalesce(p.caption, '')),
               plainto_tsquery('english'::regconfig, ${tsQuery})
             ) AS score
      FROM "Photo" p
      JOIN "Job" j ON j.id = p."jobId"
      WHERE j."organizationId" = ${organizationId}
        AND (
          p.caption ILIKE ${ilike}
          OR ${q} = ANY(p.tags)
          OR to_tsvector('english'::regconfig, coalesce(p.caption, '')) @@ plainto_tsquery('english'::regconfig, ${tsQuery})
        )
      ORDER BY score DESC
      LIMIT ${limit}
    `),
  ]);

  const hits: SearchHit[] = [];

  for (const j of jobs) {
    hits.push({
      kind: "job",
      id: j.id,
      href: `/app/jobs/${j.id}`,
      title: `${j.jobNumber} — ${j.customerName}`,
      subtitle: j.causeOfLoss ?? "Job",
      score: Number(j.score) || 0,
    });
  }
  for (const c of customers) {
    hits.push({
      kind: "customer",
      id: c.id,
      href: `/app/customers/${c.id}`,
      title: `${c.firstName} ${c.lastName}`,
      subtitle: `${c.addressLine1}, ${c.city}, ${c.state}`,
      score: Number(c.score) || 0,
    });
  }
  for (const p of photos) {
    hits.push({
      kind: "photo",
      id: p.id,
      href: `/app/jobs/${p.jobId}/photos`,
      title: p.caption ?? "Photo",
      subtitle: `Job ${p.jobNumber}`,
      score: Number(p.score) || 0,
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits;
}
