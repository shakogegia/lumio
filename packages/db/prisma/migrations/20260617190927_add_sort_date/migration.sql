-- DropIndex
DROP INDEX "Photo_takenAt_id_idx";

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "sortDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Photo_sortDate_id_idx" ON "Photo"("sortDate", "id");
