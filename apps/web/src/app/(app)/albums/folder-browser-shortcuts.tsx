"use client";

import { useEffect, useRef } from "react";
import { shouldOpenSelectedItem } from "./folder-browser-shortcut";

/**
 * Document-level keyboard shortcut for the album/folder browser: Enter opens the
 * single selected folder or album. Inert while typing in a field, while a
 * dialog/menu is open, when a modifier is held, or on key-repeat. Mirrors the
 * grid `GridShortcuts`: the listener registers once and reads the latest props
 * through a single ref so it never re-binds. The parent decides routing (folder
 * vs album) via `onEnter`.
 */
export function FolderBrowserShortcuts({
  selectedIds,
  onEnter,
}: {
  selectedIds: Set<string>;
  onEnter: (id: string) => void;
}) {
  const ref = useRef({ selectedIds, onEnter });
  useEffect(() => {
    ref.current = { selectedIds, onEnter };
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

      const open = shouldOpenSelectedItem({
        key: e.key,
        hasModifier: e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
        repeat: e.repeat,
        selectionSize: c.selectedIds.size,
        inEditable,
        overlayOpen,
      });
      if (!open) return;

      // We're handling Enter — suppress the focused card `<a>` default (it would
      // otherwise fire its click and toggle selection).
      e.preventDefault();

      const [id] = c.selectedIds;
      if (!id) return;
      c.onEnter(id);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
