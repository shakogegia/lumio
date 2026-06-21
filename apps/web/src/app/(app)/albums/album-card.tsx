"use client";

import { Images } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { SelectionRing } from "@/components/photo-grid/selection-ring";
import { cn } from "@/lib/utils";

/**
 * One album in the listing grid. Plain left click toggles selection; double click
 * opens it; ⌘/Ctrl/middle click falls through to the native link (new tab).
 * Draggable (dnd-kit) so it can be moved into folders; native link-drag is disabled.
 */
export function AlbumCard({
  album,
  isSelected,
  onToggle,
  onOpen,
}: {
  album: AlbumSummaryDTO;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const draggable = useDraggable({ id: `album-or-folder:${album.id}`, data: { type: "album", id: album.id } });

  const cover = (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-sm bg-muted">
      {album.coverPhotoId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/thumbnails/${album.coverPhotoId}`}
          alt={album.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <Images className="size-8 text-muted-foreground" />
      )}
    </div>
  );

  const meta = (
    <div className="mt-2.5">
      <p className="truncate text-sm font-semibold">{album.name}</p>
      <p className="text-xs text-muted-foreground">
        {album.photoCount} {album.photoCount === 1 ? "photo" : "photos"}
      </p>
    </div>
  );

  return (
    <a
      ref={draggable.setNodeRef}
      {...draggable.listeners}
      {...draggable.attributes}
      draggable={false}
      href={`/albums/${album.id}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.button !== 0) return;
        e.preventDefault();
        onToggle(album.id);
      }}
      onDoubleClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(album.id);
      }}
      className={cn("group block select-none", draggable.isDragging && "opacity-40")}
    >
      <div className="relative rounded-sm">
        {cover}
        {isSelected && <SelectionRing className="rounded-sm" />}
      </div>
      {meta}
    </a>
  );
}
