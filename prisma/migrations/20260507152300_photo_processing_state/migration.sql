-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "mediumKey" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "processingAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "processingError" TEXT;
