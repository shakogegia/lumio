"use client";

import { useEffect } from "react";
import { usePhotoCollection } from "./photo-collection";

/**
 * Bridges the collection's `total` (the server-reported count of the whole
 * result set) up to a parent view that renders the toolbar *outside* the
 * provider. Renders nothing; reports `total` via `onTotal` whenever it changes.
 * Reuses the count the grid already fetched — no extra request — and stays
 * correct after deletes (the store decrements `total` on removal).
 *
 * Lint: `onTotal` is a function prop, not a named `setState`, so calling it in
 * the effect satisfies `react-hooks/set-state-in-effect`.
 */
export function CollectionTotalReporter({
  onTotal,
}: {
  onTotal: (total: number | null) => void;
}) {
  const { total } = usePhotoCollection();
  useEffect(() => {
    onTotal(total);
  }, [total, onTotal]);
  return null;
}
