-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "jobNumberPrefix" TEXT NOT NULL DEFAULT 'JOB';

-- CreateTable
CREATE TABLE "JobNumberCounter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextSeq" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "JobNumberCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobNumberCounter_organizationId_year_key" ON "JobNumberCounter"("organizationId", "year");

-- AddForeignKey
ALTER TABLE "JobNumberCounter" ADD CONSTRAINT "JobNumberCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
