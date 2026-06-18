import { useCallback, useState } from "react";

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
