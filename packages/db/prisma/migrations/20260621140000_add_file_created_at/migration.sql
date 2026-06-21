-- Add the file-created (birthtime) date. The Photo table is normally empty here
-- (wiped by 20260621123000 + not yet reimported), but the DB is shared across
-- worktrees, so DELETE defensively to guarantee the NOT NULL add can't fail.
-- Reimport (pnpm ingest) after applying so rows get real created/modified dates.
DELETE FROM "Photo"; -- cascades to "AlbumPhoto"

ALTER TABLE "Photo" ADD COLUMN "fileCreatedAt" TIMESTAMP(3) NOT NULL;
