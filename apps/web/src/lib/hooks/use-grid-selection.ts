import { useCallback, useEffect, useState } from "react";
import { keyboardTargetBlocked } from "@/lib/grid-key-guard";

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
      if (keyboardTargetBlocked(e.target)) return;
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
