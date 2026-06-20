import { useCallback, useEffect, useState } from "react";

/** Owns the selected photo-id set. Selection is always available (no mode). */
export function useGridSelection() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const clear = useCallback(() => setSelected(new Set()), []);

  // Escape clears the selection. Let text fields and open overlays (dialogs, the
  // color-label menu, the photo viewer) keep Escape for themselves.
  const hasSelection = selected.size > 0;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select")) {
        return;
      }
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
        )
      ) {
        return;
      }
      e.preventDefault();
      clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasSelection, clear]);

  return {
    selected,
    setSelected,
    clear,
    count: selected.size,
  };
}
