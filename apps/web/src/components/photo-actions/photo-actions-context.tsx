"use client";

import { createContext, useContext } from "react";
import type { PhotoActions } from "./use-photo-actions";

/** Carries the view's `usePhotoActions` value down to grid tiles. Null when no
 *  provider is present (e.g. the Trash grid), which the menu treats as "no menu". */
const PhotoActionsContext = createContext<PhotoActions | null>(null);

export const PhotoActionsProvider = PhotoActionsContext.Provider;

export function usePhotoActionsContext(): PhotoActions | null {
  return useContext(PhotoActionsContext);
}
