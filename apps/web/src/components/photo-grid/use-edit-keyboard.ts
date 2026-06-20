"use client";

import { useEffect, useRef } from "react";

export interface EditKeys {
  rotateLeft: () => void;
  rotateRight: () => void;
  /** Persist the working recipe (no-ops when there's nothing to apply). */
  apply: () => void;
}

/**
 * Keyboard shortcuts for the Edit tab. Scoped by mounting: the panel that calls
 * this only exists while the tab is open (Radix unmounts inactive tab content),
 * so the listener is gone on Info/EXIF. `[` rotates left, `]` rotates right, and
 * Cmd/Ctrl+S applies (suppressing the browser Save dialog). Latest callbacks are
 * read through a ref so the listener binds once.
 */
export function useEditKeyboard(keys: EditKeys): void {
  const ref = useRef(keys);
  useEffect(() => {
    ref.current = keys;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const k = ref.current;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      // Cmd/Ctrl+S applies, replacing the browser's Save-page default.
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        k.apply();
        return;
      }
      // Bracket rotations are unmodified single presses (no hold-repeat).
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.key === "[") {
        e.preventDefault();
        k.rotateLeft();
      } else if (e.key === "]") {
        e.preventDefault();
        k.rotateRight();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
