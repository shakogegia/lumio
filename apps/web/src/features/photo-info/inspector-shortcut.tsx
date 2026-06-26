"use client";

import { useEffect, useRef } from "react";
import { usePhotoCollection } from "@/features/photo-grid";

/**
 * Grid-level `i` shortcut to toggle the detail inspector. Inert while the
 * lightbox is open (its own `i` switches to the Info tab), while typing in a
 * field, while a dialog/menu is open, or with a modifier held. Mirrors the
 * guards in `GridShortcuts`; registers once and reads the latest props via a ref.
 */
export function InspectorShortcut({ onToggle }: { onToggle: () => void }) {
  const { openIndex } = usePhotoCollection();
  const ref = useRef({ openIndex, onToggle });
  useEffect(() => {
    ref.current = { openIndex, onToggle };
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "i" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
      const c = ref.current;
      if (c.openIndex !== null) return; // lightbox owns `i` while it's open
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      )
        return;
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
        )
      )
        return;
      e.preventDefault();
      c.onToggle();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
