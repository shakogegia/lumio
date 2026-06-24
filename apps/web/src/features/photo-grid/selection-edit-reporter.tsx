"use client";

import { useEffect } from "react";
import { hasEdits } from "@lumio/shared";
import { usePhotoCollection } from "./photo-collection";

/**
 * Bridges "does the current selection contain any edited photo?" up to a parent
 * view that renders the selection toolbar *outside* the provider, so its
 * Download control can offer an edited-vs-original choice. Renders nothing;
 * reports via `onAnyEdited` whenever the answer changes. Reuses the photos the
 * grid already loaded (`getPhotos` is reactive on the store), so it stays
 * correct as the selection changes or edits are saved — no extra request.
 *
 * Only loaded photos are considered: a selection spanning not-yet-fetched pages
 * could under-report edits and fall back to the plain Download button. Harmless
 * — the server still bakes edits per photo for the chosen variant. Mirrors the
 * grid's right-click menu (PhotoContextMenu).
 *
 * Lint: `onAnyEdited` is a function prop, not a named `setState`, so calling it
 * in the effect satisfies `react-hooks/set-state-in-effect`.
 */
export function SelectionEditReporter({
  selectedIds,
  onAnyEdited,
}: {
  selectedIds: Set<string>;
  onAnyEdited: (anyEdited: boolean) => void;
}) {
  const { getPhotos } = usePhotoCollection();
  const anyEdited = getPhotos(selectedIds).some((p) => hasEdits(p.edits));
  useEffect(() => {
    onAnyEdited(anyEdited);
  }, [anyEdited, onAnyEdited]);
  return null;
}
