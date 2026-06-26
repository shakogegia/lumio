-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "cameraMake" TEXT,
ADD COLUMN     "cameraModel" TEXT,
ADD COLUMN     "exposureTime" DOUBLE PRECISION,
ADD COLUMN     "fNumber" DOUBLE PRECISION,
ADD COLUMN     "focalLength" DOUBLE PRECISION,
ADD COLUMN     "gpsLat" DOUBLE PRECISION,
ADD COLUMN     "gpsLng" DOUBLE PRECISION,
ADD COLUMN     "hasGps" BOOLEAN,
ADD COLUMN     "iso" INTEGER,
ADD COLUMN     "lensModel" TEXT;

-- CreateIndex
CREATE INDEX "Photo_takenAt_idx" ON "Photo"("takenAt");

-- CreateIndex
CREATE INDEX "Photo_cameraModel_idx" ON "Photo"("cameraModel");

-- CreateIndex
CREATE INDEX "Photo_lensModel_idx" ON "Photo"("lensModel");

-- CreateIndex
CREATE INDEX "Photo_iso_idx" ON "Photo"("iso");

-- CreateIndex
CREATE INDEX "Photo_fNumber_idx" ON "Photo"("fNumber");

-- CreateIndex
CREATE INDEX "Photo_focalLength_idx" ON "Photo"("focalLength");
