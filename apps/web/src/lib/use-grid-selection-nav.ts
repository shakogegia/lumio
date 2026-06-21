"use client";

import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import {
  arrowSelection,
  computeSelection,
  nextGridIndex,
  type ArrowKey,
} from "./grid-selection";
import { keyboardTargetBlocked } from "./grid-key-guard";

const ARROW_KEYS = new Set<string>(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

type NavState = {
  /** Total item count (virtualized grids include not-yet-loaded items). */
  count: number;
  columns: number;
  /** Id at an index, or undefined if not loaded. Used for keyboard selection. */
  idAt: (index: number) => string | undefined;
  /** Ordered ids for click selection (shift-range math). */
  getClickIds: () => string[];
  selectedIds: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Open the item at an index (Enter / nav). Omit where there is no target. */
  onOpen?: (index: number) => void;
  /** Bring the item at an index into view after a keyboard move. */
  scrollToIndex?: (index: number) => void;
};

/**
 * Shared mouse + keyboard selection driver for a grid of `count` items laid out
 * in `columns`. Plain click / arrow selects one item; ⌘/Ctrl click toggles;
 * shift click / arrow extends a range from the anchor; Enter opens the cursor
 * item. The anchor (range origin) and lead (cursor) are kept in sync across both
 * input methods, so clicking and then arrowing feels continuous.
 */
export function useGridSelectionNav(state: NavState) {
  // Latest props for the once-registered keydown listener and the stable click
  // handler. Updated in an effect (never during render) per the refs lint rule.
  const ref = useRef(state);
  useEffect(() => {
    ref.current = state;
  });

  const anchorRef = useRef<number | null>(null); // fixed end of a shift range
  const leadRef = useRef<number | null>(null); // moving cursor

  // Clear the anchor + cursor whenever the selection empties (Escape, the
  // toolbar's clear, or a bulk action) so the next interaction starts fresh.
  const empty = state.selectedIds.size === 0;
  useEffect(() => {
    if (empty) {
      anchorRef.current = null;
      leadRef.current = null;
    }
  }, [empty]);

  const handleItemClick = useCallback((index: number, e: React.MouseEvent) => {
    const s = ref.current;
    if (!s.onSelectionChange) return;
    const toggle = e.metaKey || e.ctrlKey;
    const next = computeSelection(
      s.selectedIds,
      s.getClickIds(),
      index,
      { shift: e.shiftKey, toggle },
      anchorRef.current,
    );
    if (!e.shiftKey) anchorRef.current = index;
    leadRef.current = index;
    s.onSelectionChange(next);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = ref.current;
      if (!s.onSelectionChange || s.count <= 0) return;
      if (keyboardTargetBlocked(e.target)) return;

      if (e.key === "Enter") {
        if (leadRef.current !== null && s.onOpen) {
          e.preventDefault();
          s.onOpen(leadRef.current);
        }
        return;
      }
      if (!ARROW_KEYS.has(e.key)) return;
      e.preventDefault();

      const lead = nextGridIndex(leadRef.current, e.key as ArrowKey, s.columns, s.count);
      leadRef.current = lead;
      // A plain move re-anchors; the first shift move (no anchor yet) anchors in
      // place so subsequent shift moves extend a range.
      if (!e.shiftKey) anchorRef.current = lead;
      else if (anchorRef.current === null) anchorRef.current = lead;

      // Only (re)select when the target is loaded; arrowing into a not-yet
      // loaded virtualized cell still moves + scrolls so the cell can load.
      if (s.idAt(lead) !== undefined) {
        s.onSelectionChange(arrowSelection(s.idAt, lead, e.shiftKey, anchorRef.current));
      }
      s.scrollToIndex?.(lead);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return { handleItemClick };
}
