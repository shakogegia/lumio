-- Additive, nullable column for fractional ordering of catalogs.
ALTER TABLE "Catalog" ADD COLUMN "position" TEXT;
