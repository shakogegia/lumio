-- AlterTable
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "trashedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Photo_catalogId_trashedAt_idx" ON "Photo"("catalogId", "trashedAt");
