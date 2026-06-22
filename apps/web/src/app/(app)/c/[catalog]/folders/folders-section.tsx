"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { computeSelection } from "@/lib/grid-selection";
import { catalogPath } from "@/lib/catalog-api";
import type { FolderSummary } from "@/lib/catalog-fs-service";
import { DiskFolderCard } from "./disk-folder-card";

function folderHref(slug: string, rel: string): string {
  return `${catalogPath(slug, "/folders")}?path=${encodeURIComponent(rel)}`;
}

/**
 * Album-style, selectable folder cards above the photo grid; hidden when there
 * are none. Owns its OWN selection, separate from the photo grid below: click
 * selects only that folder, ⌘/Ctrl toggles, shift extends a range; double click
 * (or the card link) opens. Filesystem actions (rename/move/delete) are deferred —
 * the selection bar is the hook for them.
 */
export function FoldersSection({ slug, folders }: { slug: string; folders: FolderSummary[] }) {
  const router = useRouter();
  const sel = useGridSelection();
  const anchorRef = useRef<number | null>(null);

  // Reset the shift-range anchor whenever the selection empties (Escape / Cancel),
  // so the next shift-click starts a fresh range. Refs are written in an effect,
  // never during render.
  const empty = sel.count === 0;
  useEffect(() => {
    if (empty) anchorRef.current = null;
  }, [empty]);

  if (folders.length === 0) return null;

  const ids = folders.map((f) => f.rel);

  function onSelect(rel: string, e: React.MouseEvent) {
    const index = ids.indexOf(rel);
    if (index < 0) return;
    const next = computeSelection(
      sel.selected,
      ids,
      index,
      { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey },
      anchorRef.current,
    );
    if (!e.shiftKey) anchorRef.current = index;
    sel.setSelected(next);
  }

  function onOpen(rel: string) {
    router.push(folderHref(slug, rel));
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {sel.count > 0 ? `${sel.count} selected` : "Folders"}
        </h2>
        {sel.count > 0 && (
          <Button variant="ghost" size="sm" onClick={sel.clear}>
            Cancel
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-5 gap-y-7">
        {folders.map((f) => (
          <DiskFolderCard
            key={f.rel}
            slug={slug}
            folder={f}
            isSelected={sel.selected.has(f.rel)}
            onSelect={onSelect}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}
