import { getUserSettings, updateUserSettings } from "@lumio/db";

export function getProfile(userId: string) {
  return getUserSettings(userId);
}

export function updateProfile(userId: string, input: { soundEffectsEnabled?: boolean }) {
  return updateUserSettings(userId, input);
}
