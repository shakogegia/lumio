"use client";

import { Folder as FolderIcon } from "lucide-react";
import type { FolderSummaryDTO } from "@lumio/shared";
import { SelectionRing } from "@/components/photo-grid/selection-ring";

/**
 * One folder in the listing grid. Mirrors AlbumCard interaction: plain click
 * toggles selection, double-click opens. The cover is a 2×2 mosaic of preview
 * thumbnails, falling back to a folder glyph when empty.
 */
export function FolderCard({
  folder,
  isSelected,
  onToggle,
  onOpen,
}: {
  folder: FolderSummaryDTO;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const previews = folder.previewPhotoIds;
  const cover = (
    <div className="relative grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-sm bg-muted">
      {previews.length === 0 ? (
        <div className="col-span-2 row-span-2 flex items-center justify-center">
          <FolderIcon className="size-8 text-muted-foreground" />
        </div>
      ) : (
        Array.from({ length: 4 }).map((_, i) =>
          previews[i] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={previews[i]}
              src={`/api/thumbnails/${previews[i]}`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div key={i} className="bg-muted" />
          ),
        )
      )}
    </div>
  );

  const parts = [`${folder.albumCount} ${folder.albumCount === 1 ? "album" : "albums"}`];
  if (folder.totalPhotoCount > 0) {
    parts.push(`${folder.totalPhotoCount} ${folder.totalPhotoCount === 1 ? "photo" : "photos"}`);
  }

  return (
    <a
      href={`/albums/folder/${folder.id}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.button !== 0) return;
        e.preventDefault();
        onToggle(folder.id);
      }}
      onDoubleClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(folder.id);
      }}
      className="group block select-none"
    >
      <div className="relative rounded-sm">
        {cover}
        {isSelected && <SelectionRing className="rounded-sm" />}
      </div>
      <div className="mt-2.5">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {folder.name}
        </p>
        <p className="text-xs text-muted-foreground">{parts.join(" · ")}</p>
      </div>
    </a>
  );
}
