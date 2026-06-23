-- AlterTable: add dirPath (default '' so existing rows satisfy NOT NULL)
ALTER TABLE "Photo" ADD COLUMN "dirPath" TEXT NOT NULL DEFAULT '';

-- Backfill the parent directory from each photo's existing catalog-relative path
-- ('' for files at the catalog root).
UPDATE "Photo"
SET "dirPath" = CASE
  WHEN "path" LIKE '%/%' THEN regexp_replace("path", '/[^/]*$', '')
  ELSE ''
END;

-- CreateIndex
CREATE INDEX "Photo_catalogId_dirPath_idx" ON "Photo"("catalogId", "dirPath");
