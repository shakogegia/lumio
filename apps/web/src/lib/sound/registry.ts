/**
 * Catalog of UI sound effects. To add a sound: add an enum member, a URL entry
 * below, and drop the matching file in `apps/web/public/sounds/`.
 */
export enum SoundEffect {
  MoveToTrash = "move-to-trash",
  EmptyTrash = "empty-trash",
}

/** Public URL (served from `apps/web/public`) for each effect. */
export const SOUND_URLS: Record<SoundEffect, string> = {
  [SoundEffect.MoveToTrash]: "/sounds/move-to-trash.mp3",
  [SoundEffect.EmptyTrash]: "/sounds/empty-trash.mp3",
};

/** Default playback volume for all effects (0–1). */
export const SOUND_VOLUME = 0.5;
