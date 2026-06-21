import { SOUND_URLS, SOUND_VOLUME, type SoundEffect } from "./registry.js";

// Module-level mirror of the persisted "sound effects" setting. Defaults on;
// SoundSettingsProvider syncs it to the DB value after mount.
let enabled = true;

/** Update whether sound effects play. Called by SoundSettingsProvider + the toggle. */
export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

/**
 * Play a UI sound effect. No-op when disabled or off the client. Creates a fresh
 * Audio per call (the file is HTTP-cached after first play), which keeps it
 * testable and lets rapid triggers overlap. All playback errors — autoplay-policy
 * rejections, decode failures — are swallowed so a sound can never break an action.
 */
export function playSound(effect: SoundEffect): void {
  if (!enabled) return;
  if (typeof Audio === "undefined") return; // SSR / non-DOM
  const audio = new Audio(SOUND_URLS[effect]);
  audio.volume = SOUND_VOLUME;
  void audio.play().catch(() => {});
}
