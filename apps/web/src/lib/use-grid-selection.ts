import { useCallback, useEffect, useState } from "react";

/** Owns select-mode toggle + the selected photo-id set. Page-agnostic. */
export function useGridSelection() {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const enter = useCallback(() => setSelectMode(true), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const cancel = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  // Escape while selecting: clear the selection first; press it again (nothing
  // selected) to leave select mode. Trash runs in permanent select mode
  // (selectMode stays false), so there Escape only ever clears.
  const hasSelection = selected.size > 0;
  useEffect(() => {
    if (!selectMode && !hasSelection) return; // nothing for Escape to do
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Let text fields and open overlays (dialogs, the color-label menu in the
      // toolbar, the photo viewer) keep Escape for themselves.
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
      if (hasSelection) clear();
      else cancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectMode, hasSelection, clear, cancel]);

  return {
    selectMode,
    selected,
    setSelected,
    enter,
    cancel,
    clear,
    count: selected.size,
  };
}
