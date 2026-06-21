-- Add a per-app "sound effects enabled" preference. Additive and non-destructive:
-- the DEFAULT lets the existing singleton AppSettings row migrate cleanly.
ALTER TABLE "AppSettings" ADD COLUMN "soundEffectsEnabled" BOOLEAN NOT NULL DEFAULT true;
