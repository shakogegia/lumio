"use client";

import { useEffect, useRef } from "react";
import { computeFavoriteTarget } from "@lumio/shared";
import { resolveGridShortcut } from "@/lib/grid-shortcut";
import { usePhotoActionsContext } from "@/components/photo-actions/photo-actions-context";
import { usePhotoCollection } from "./photo-collection";

/**
 * Document-level keyboard shortcuts for a photo grid:
 *   f      — toggle favourite over the whole selection (smart target)
 *   Enter  — open the single selected photo on the Info tab
 *   e      — open the single selected photo on the Edit tab
 *
 * Inert while the lightbox is open, while typing in a field, while a dialog/menu
 * is open, or while a modifier is held. Mirrors `useLightboxKeyboard`: the
 * listener registers once and reads the latest props through a single ref so it
 * never re-binds. The decision is delegated to the pure `resolveGridShortcut`.
 */
export function GridShortcuts({ selectedIds }: { selectedIds: Set<string> }) {
  const { open, openIndex, getLoadedIds, getPhotos } = usePhotoCollection();
  const actions = usePhotoActionsContext();

  const ref = useRef({ selectedIds, open, openIndex, getLoadedIds, getPhotos, actions });
  useEffect(() => {
    ref.current = { selectedIds, open, openIndex, getLoadedIds, getPhotos, actions };
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const c = ref.current;
      const el = document.activeElement;
      const inEditable =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      const overlayOpen =
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
        ) !== null;

      const action = resolveGridShortcut({
        key: e.key,
        hasModifier: e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
        repeat: e.repeat,
        selectionSize: c.selectedIds.size,
        lightboxOpen: c.openIndex !== null,
        inEditable,
        overlayOpen,
      });
      if (!action) return;

      // We're handling this key — suppress the browser default (e.g. Enter on a
      // focused tile `<a>` would otherwise fire its click and toggle selection).
      e.preventDefault();

      if (action.kind === "favorite") {
        if (!c.actions) return;
        const ids = [...c.selectedIds];
        const target = computeFavoriteTarget(c.getPhotos(c.selectedIds));
        void c.actions.favorite(ids, target);
        return;
      }

      if (action.kind === "trash") {
        if (!c.actions) return;
        void c.actions.trash([...c.selectedIds]);
        return;
      }

      // action.kind === "open" — selectionSize is guaranteed 1 by the resolver.
      const [id] = c.selectedIds;
      if (!id) return;
      const index = c.getLoadedIds().indexOf(id);
      if (index === -1) return; // selected ids are always loaded; guard defensively
      c.open(index, { tab: action.tab });
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
