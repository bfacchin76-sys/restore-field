-- Audit M3+M4: surface report-generation failures so operators can see
-- WHY a Report row is stuck. Mirrors the Photo model's
-- (processingError, processingAttempts) shape. Existing rows pre-fix
-- have pdfStorageKey="" once the worker stamps; mark those NOT stuck.

ALTER TABLE "Report" ALTER COLUMN "pdfStorageKey" DROP NOT NULL;
UPDATE "Report" SET "pdfStorageKey" = NULL WHERE "pdfStorageKey" = '';

ALTER TABLE "Report" ADD COLUMN "processingError"    TEXT;
ALTER TABLE "Report" ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0;
