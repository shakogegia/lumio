-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "isFavorite" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Photo_isFavorite_sortDate_idx" ON "Photo"("isFavorite", "sortDate");
