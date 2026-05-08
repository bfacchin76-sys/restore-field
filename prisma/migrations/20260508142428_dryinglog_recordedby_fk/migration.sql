-- Audit L3: DryingLog.recordedById had no FK back to User. Every
-- other *ById column on the schema does, so this is just plugging
-- a consistency gap. Default ON UPDATE / ON DELETE policy matches
-- Photo.uploadedById and Report.generatedById.

ALTER TABLE "DryingLog"
  ADD CONSTRAINT "DryingLog_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
