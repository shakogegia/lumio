"use client";

import { useEffect } from "react";
import { setSoundEnabled } from "@/lib/sound/player";

/**
 * Syncs the client sound player's enabled flag to the persisted setting.
 * Renders nothing; mounted once in the app layout, seeded from the DB value.
 */
export function SoundSettingsProvider({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    setSoundEnabled(enabled);
  }, [enabled]);
  return null;
}
