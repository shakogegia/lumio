ALTER TABLE "PhotoMetadataValue" ADD COLUMN "numValue" DOUBLE PRECISION;
CREATE INDEX "PhotoMetadataValue_fieldId_numValue_idx" ON "PhotoMetadataValue"("fieldId", "numValue");
-- backfill existing numeric-looking values
UPDATE "PhotoMetadataValue" SET "numValue" = "value"::double precision WHERE "value" ~ '^-?[0-9]+(\.[0-9]+)?$';
