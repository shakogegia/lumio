-- AddPhotoExtension
ALTER TABLE "Photo" ADD COLUMN "extension" TEXT NOT NULL DEFAULT '';

-- Backfill from the stored relative path: chars after the final dot, excluding
-- dots/slashes, anchored to end-of-string. substring() is NULL when there is no
-- extension; COALESCE keeps the NOT NULL column valid.
UPDATE "Photo" SET "extension" = COALESCE(lower(substring("path" from '\.([^./]+)$')), '');

CREATE INDEX "Photo_catalogId_extension_idx" ON "Photo"("catalogId", "extension");
