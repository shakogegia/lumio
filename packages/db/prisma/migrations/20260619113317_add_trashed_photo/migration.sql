-- CreateTable
CREATE TABLE "TrashedPhoto" (
    "id" TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "source" "PhotoSource" NOT NULL,
    "takenAt" TIMESTAMP(3),
    "sortDate" TIMESTAMP(3) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "hash" TEXT,
    "exif" JSONB NOT NULL,
    "albumIds" TEXT[],
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrashedPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrashedPhoto_deletedAt_id_idx" ON "TrashedPhoto"("deletedAt", "id");
