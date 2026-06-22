"use client";

import { useCallback, useState } from "react";
import {
  FOLDER_PREFS_COOKIE,
  serializeFolderPrefs,
  type FolderPrefs,
} from "@/lib/folder-prefs";

/**
 * Folder-explorer prefs seeded from the server (cookie) so first paint matches
 * the user's choice. Writes persist back to the cookie (1 year) so later SSR
 * renders stay correct.
 */
export function useFolderPrefs(initial: FolderPrefs) {
  const [prefs, setPrefs] = useState(initial);
  const update = useCallback((patch: Partial<FolderPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      document.cookie = `${FOLDER_PREFS_COOKIE}=${encodeURIComponent(
        serializeFolderPrefs(next),
      )}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);
  return { prefs, update };
}
