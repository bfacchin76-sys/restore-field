-- Phase 10: Postgres full-text search indexes + NotificationPreference
-- table for per-user "email me when …" toggles.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Job: search across job number, cause, scope notes.
CREATE INDEX IF NOT EXISTS "Job_search_idx"
  ON "Job"
  USING GIN ((
    setweight(to_tsvector('simple'::regconfig, coalesce("jobNumber", '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce("causeOfLoss", '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce("scopeNotes", '')), 'C')
  ));

-- Cheap trigram index on jobNumber for "1800-2026-04" style prefixes.
CREATE INDEX IF NOT EXISTS "Job_jobNumber_trgm_idx"
  ON "Job" USING GIN ("jobNumber" gin_trgm_ops);

-- Customer: name + claim/policy + address.
CREATE INDEX IF NOT EXISTS "Customer_search_idx"
  ON "Customer"
  USING GIN ((
    setweight(to_tsvector('simple'::regconfig, "firstName" || ' ' || "lastName"), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce("addressLine1", '') || ' ' || coalesce("city", '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce("policyNumber", '') || ' ' || coalesce("claimNumber", '')), 'C')
  ));

-- Photo caption only — `tags` is text[] and array_to_string is STABLE,
-- so we filter tags separately at query time.
CREATE INDEX IF NOT EXISTS "Photo_caption_search_idx"
  ON "Photo"
  USING GIN ((to_tsvector('english'::regconfig, coalesce("caption", ''))));

-- =========================================================================
-- NotificationPreference: per-user "email me when …" toggles. Phase 10.
-- =========================================================================

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emailJobStatusChange" BOOLEAN NOT NULL DEFAULT true,
  "emailJobAssigned" BOOLEAN NOT NULL DEFAULT true,
  "emailReportShared" BOOLEAN NOT NULL DEFAULT false,
  "emailWeeklyDigest" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_userId_key"
  ON "NotificationPreference"("userId");

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
