-- file-stat columns become NOT NULL and a new fileModifiedAt is added. Existing
-- rows can't satisfy NOT NULL and are fully reconstructable from disk, so empty
-- the library first, then reimport (pnpm ingest) after this migration.
--
-- NOTE: this Postgres is shared across all Conductor worktrees; these DELETEs
-- wipe the Photo table everywhere. Intentional (spec option C).
DELETE FROM "Photo";          -- cascades to "AlbumPhoto" (onDelete: Cascade)
DELETE FROM "TrashedPhoto";   -- independent table; cleared for a full reset

-- AlterTable: add the readable mirror and tighten the fingerprint columns.
ALTER TABLE "Photo" ADD COLUMN "fileModifiedAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "Photo" ALTER COLUMN "fileSize" SET NOT NULL;
ALTER TABLE "Photo" ALTER COLUMN "fileMtimeMs" SET NOT NULL;
