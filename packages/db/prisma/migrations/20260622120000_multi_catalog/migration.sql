-- Multi-catalog: Catalog becomes the top-level scope. Destructive clean wipe
-- (no backfill) — photo/album/folder/trash/job data is truncated; re-scan rebuilds.

-- 1. Wipe scoped data first so the new NOT NULL catalogId columns add cleanly.
TRUNCATE TABLE "AlbumPhoto", "Album", "Folder", "TrashedPhoto", "Photo", "Job" CASCADE;

-- 2. Catalog.
CREATE TABLE "Catalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "uploadTemplate" TEXT NOT NULL DEFAULT '{YYYY}/{YYYY}-{MM}-{DD}/{filename}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Catalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Catalog_slug_key" ON "Catalog"("slug");
CREATE UNIQUE INDEX "Catalog_path_key" ON "Catalog"("path");

-- 3. UserSettings.
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "soundEffectsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. catalogId columns (NOT NULL is safe — tables were just truncated).
ALTER TABLE "Photo" ADD COLUMN "catalogId" TEXT NOT NULL;
ALTER TABLE "Album" ADD COLUMN "catalogId" TEXT NOT NULL;
ALTER TABLE "Folder" ADD COLUMN "catalogId" TEXT NOT NULL;
ALTER TABLE "TrashedPhoto" ADD COLUMN "catalogId" TEXT NOT NULL;
ALTER TABLE "Job" ADD COLUMN "catalogId" TEXT;

-- 5. Photo path uniqueness: global -> per-catalog.
DROP INDEX "Photo_path_key";
CREATE UNIQUE INDEX "Photo_catalogId_path_key" ON "Photo"("catalogId", "path");
CREATE INDEX "Photo_catalogId_idx" ON "Photo"("catalogId");
CREATE INDEX "Album_catalogId_idx" ON "Album"("catalogId");
CREATE INDEX "Folder_catalogId_idx" ON "Folder"("catalogId");
CREATE INDEX "TrashedPhoto_catalogId_idx" ON "TrashedPhoto"("catalogId");

-- 6. Foreign keys.
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Album" ADD CONSTRAINT "Album_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrashedPhoto" ADD CONSTRAINT "TrashedPhoto_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
